/* eslint-disable no-await-in-loop */
const axios = require('axios');
const config = require('config');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');

const axiosConfig = {
  timeout: 13456,
};

let db = null;
const geocollection = config.database.local.collections.geolocation;
const znodecollection = config.database.local.collections.znodes;
const completedRoundsCollection = config.database.local.collections.completedRounds;

let currentZnodeIps = [];

async function getZnodeList() {
  try {
    const znodeList = await axios.get(`${config.explorer}/api/znodes/listznodesarray`, axiosConfig);
    return znodeList.data.result || [];
  } catch (e) {
    log.error(e);
    return [];
  }
}

async function getZnodeIPs(znodeList) {
  try {
    const znodes = znodeList || await getZnodeList();
    const ips = znodes.map((znode) => znode.ip);
    return ips;
  } catch (e) {
    log.error(e);
    return [];
  }
}

async function getZnodeGeolocation(ip) {
  try {
    const ipApiUrl = `http://ip-api.com/json/${ip}?fields=status,country,countryCode,lat,lon,query,org`;
    const ipRes = await axios.get(ipApiUrl, axiosConfig);
    if (ipRes.data.status === 'success') {
      const information = {
        ip: ipRes.data.query,
        country: ipRes.data.country,
        countryCode: ipRes.data.countryCode,
        lat: ipRes.data.lat,
        lon: ipRes.data.lon,
        org: ipRes.data.org,
      };
      // push this to our database
      return information;
    }
    log.warn(`Geolocation of IP ${ip} is unavailable`);
    return false;
  } catch (e) {
    log.error(`Geolocation of IP ${ip} error`);
    return false;
  }
}

async function processZnodes() {
  try {
    const currentRoundTime = new Date().getTime();
    const znodes = await getZnodeList();
    log.info(`Beginning processing of ${currentRoundTime}.`);
    const database = db.db(config.database.local.database);
    currentZnodeIps = await getZnodeIPs(znodes);
    log.info(`Found ${znodes.length} Znodes.`);

    // eslint-disable-next-line no-restricted-syntax
    for (const [i, znode] of znodes.entries()) {
      const curZnode = znode;
      const query = { ip: znode.ip };
      const projection = {
        projection: {
          _id: 0,
          ip: 1,
          country: 1,
          countryCode: 1,
          lat: 1,
          lon: 1,
          org: 1,
        },
      };
      // we shall always have geolocation
      const result = await serviceHelper.findOneInDatabase(database, geocollection, query, projection).catch((error) => {
        log.error(error);
      });
      if (result) {
        curZnode.geolocation = result;
      } else {
        // we do not have info about that ip yet. Get it and Store it.
        await serviceHelper.timeout(2000);
        const geoRes = await getZnodeGeolocation(znode.ip);
        if (geoRes) {
          // geo ok, store it and update curZnode.
          await serviceHelper.insertOneToDatabase(database, geocollection, geoRes).catch((error) => {
            log.error(error);
          });
          curZnode.geolocation = geoRes;
        }
      }
      curZnode.roundTime = currentRoundTime;
      const curTime = new Date().getTime();
      curZnode.dataCollectedAt = curTime;
      await serviceHelper.insertOneToDatabase(database, znodecollection, curZnode).catch((error) => {
        log.error(error);
      });
      if ((i + 1) % 25 === 0) {
        log.info(`Checked ${i + 1}/${znodes.length}.`);
        const colStats = await serviceHelper.collectionStats(database, znodecollection).catch((error) => {
          throw error;
        });
        log.info('Znode', colStats.size, colStats.count, colStats.avgObjSize);
      }
    }
    log.info(`Processing of ${currentRoundTime} finished.`);
    const crt = {
      timestamp: currentRoundTime,
    };
    await serviceHelper.insertOneToDatabase(database, completedRoundsCollection, crt).catch((error) => {
      log.error(error);
    });
    setTimeout(() => {
      processZnodes();
    }, 1 * 60 * 1000);
  } catch (e) {
    log.error(e);
    setTimeout(() => {
      processZnodes();
    }, 1 * 60 * 1000);
  }
}

async function getAllGeolocation(req, res) {
  const database = db.db(config.database.local.database);
  const query = {};
  const projection = {
    projection: {
      _id: 0,
    },
  };
  const results = await serviceHelper.findInDatabase(database, geocollection, query, projection).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
    throw error;
  });
  const resMessage = serviceHelper.createDataMessage(results);
  return res.json(resMessage);
}

async function getAllZnodeInformation(req, res) {
  const database = db.db(config.database.local.database);
  const q = {};
  const p = {};
  const lastRound = await serviceHelper.findOneInDatabaseReverse(database, completedRoundsCollection, q, p).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
  });
  const lastCompletedRound = lastRound ? lastRound.timestamp : 0;
  const queryForIps = [];
  currentZnodeIps.forEach((ip) => {
    const singlequery = {
      ip,
    };
    queryForIps.push(singlequery);
  });
  const query = {
    $or: queryForIps,
    roundTime: lastCompletedRound,
  };
  const projection = {
    projection: {
      _id: 0,
    },
  };
  // return latest znode round
  const results = await serviceHelper.findInDatabase(database, znodecollection, query, projection).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
  });
  const resMessage = serviceHelper.createDataMessage(results);
  return res.json(resMessage);
}

async function getAllZnodeGeolocation(req, res) {
  const database = db.db(config.database.local.database);
  const q = {};
  const p = {};
  const lastRound = await serviceHelper.findOneInDatabaseReverse(database, completedRoundsCollection, q, p).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
  });
  const lastCompletedRound = lastRound ? lastRound.timestamp : 0;
  const queryForIps = [];
  currentZnodeIps.forEach((ip) => {
    const singlequery = {
      ip,
    };
    queryForIps.push(singlequery);
  });
  const query = {
    $or: queryForIps,
    roundTime: lastCompletedRound,
  };
  const projection = {
    projection: {
      _id: 0,
      geolocation: 1,
    },
  };
  // return latest znode round
  const results = await serviceHelper.findInDatabase(database, znodecollection, query, projection).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
  });
  const bresults = results.map((x) => x.geolocation);
  const resMessage = serviceHelper.createDataMessage(bresults);
  return res.json(resMessage);
}

async function getCompletedRoundsTimestamps(req, res) {
  const database = db.db(config.database.local.database);
  const q = {};
  const p = {};
  const completedRounds = await serviceHelper.findInDatabase(database, completedRoundsCollection, q, p).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
  });
  const bresults = completedRounds.map((x) => x.timestamp);
  const resMessage = serviceHelper.createDataMessage(bresults);
  return res.json(resMessage);
}

async function getAllZnodeGeolocationNow(req, res) {
  const database = db.db(config.database.local.database);
  const queryForIps = [];
  const znodeIpsNow = await getZnodeIPs();
  znodeIpsNow.forEach((ip) => {
    const singlequery = {
      ip,
    };
    queryForIps.push(singlequery);
  });
  const query = {
    $or: queryForIps,
  };
  const projection = {
    projection: {
      _id: 0,
      geolocation: 1,
    },
  };
  // return latest znode round
  const results = await serviceHelper.findInDatabase(database, znodecollection, query, projection).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
  });
  const bresults = results.map((x) => x.geolocation);
  const cresults = [...new Set(bresults)];
  const resMessage = serviceHelper.createDataMessage(cresults);
  return res.json(resMessage);
}

async function start() {
  try {
    db = await serviceHelper.connectMongoDb().catch((error) => {
      log.error(error);
      throw error;
    });
    log.info('Initiating Znode API services...');
    // begin znodes processing;
    processZnodes();
  } catch (e) {
    // restart service after 5 mins
    log.error(e);
    setTimeout(() => {
      start();
    }, 5 * 30 * 1000);
  }
}
module.exports = {
  start,
  getZnodeIPs,
  getAllGeolocation,
  getAllZnodeInformation,
  getAllZnodeGeolocation,
  getCompletedRoundsTimestamps,
  getAllZnodeGeolocationNow,
};
