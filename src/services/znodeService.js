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
      const update = { $set: curZnode };
      const options = {
        upsert: true,
      };
      await serviceHelper.updateOneInDatabase(database, znodecollection, query, update, options).catch((error) => {
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
    setTimeout(() => {
      processZnodes();
    }, 15 * 60 * 1000);
  } catch (e) {
    log.error(e);
    setTimeout(() => {
      processZnodes();
    }, 15 * 60 * 1000);
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
  const queryForIps = [];
  currentZnodeIps.forEach((ip) => {
    const singlequery = {
      ip,
    };
    if (ip.length > 5) {
      queryForIps.push(singlequery);
    }
  });

  const query = {};
  if (queryForIps.length > 0) {
    query.$or = queryForIps;
  }

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

async function getAllZnodeGeolocationNow(req, res) {
  const database = db.db(config.database.local.database);
  const queryForIps = [];
  currentZnodeIps.forEach((ip) => {
    const singlequery = {
      ip,
    };
    if (ip.length > 5) {
      queryForIps.push(singlequery);
    }
  });

  const query = {};
  if (queryForIps.length > 0) {
    query.$or = queryForIps;
  }

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
  const cresults = bresults.filter((v, i, a) => a.findIndex((t) => t && v && (t.ip === v.ip)) === i);
  const resMessage = serviceHelper.createDataMessage(cresults);
  return res.json(resMessage);
}

async function start() {
  try {
    db = await serviceHelper.connectMongoDb().catch((error) => {
      log.error(error);
      throw error;
    });
    const database = db.db(config.database.local.database);
    database.collection(znodecollection).createIndex({ ip: 1 }, { name: 'query for getting list of Znode data associated to IP address' });
    log.info('Initiating Znode API services...');
    // begin znodes processing;
    processZnodes();
  } catch (e) {
    // restart service after 5 mins
    log.error(e);
    setTimeout(() => {
      start();
    }, 15 * 30 * 1000);
  }
}
module.exports = {
  start,
  getZnodeIPs,
  getAllGeolocation,
  getAllZnodeInformation,
  getAllZnodeGeolocationNow,
};
