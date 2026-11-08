const core = require('zapier-platform-core');
const auth = require('./authentication');
const triggers = require('./triggers');
const searches = require('./searches');
const creates = require('./creates');

module.exports = {
  version: require('./package.json').version,
  platformVersion: core.version,
  authentication: auth.authentication,
  beforeRequest: [auth.includeApiKey],
  triggers,
  searches: searches.searches,
  creates: creates.creates,
};
