const apicache = require('apicache');
const znodeService = require('./services/znodeService');

const cache = apicache.middleware;

module.exports = (app) => {
  // health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });
  // GET methods
  app.get('/storedlocations', cache('5 minutes'), (req, res) => {
    znodeService.getAllGeolocation(req, res);
  });
  app.get('/znodeinfo', cache('10 minutes'), (req, res) => {
    znodeService.getAllZnodeInformation(req, res);
  });
  app.get('/znodelocations', cache('5 minutes'), (req, res) => {
    znodeService.getAllZnodeGeolocationNow(req, res);
  });
};
