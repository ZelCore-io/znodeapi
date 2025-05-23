module.exports = {
  server: {
    port: 8123,
  },
  explorer: 'https://explorer.firo.zelcore.io',
  database: {
    url: '127.0.0.1',
    port: 27017,
    local: {
      database: 'znodesapi',
      collections: {
        // Array of round of znode explorer call + geolocation.
        znodes: 'znodes3',
        // geolocations of ip addresses belonging to znode instances
        geolocation: 'geolocation',
        // timestamp of completed full rounds
        completedRounds: 'completedrounds',
      },
    },
  },
};
