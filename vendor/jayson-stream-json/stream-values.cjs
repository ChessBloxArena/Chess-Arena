// Jayson 4 uses only this legacy factory; stream-json 3 renamed the Node stream API.
const { default: streamValues } = require('stream-json-current/streamers/stream-values.js');
module.exports = { withParser: options => streamValues.withParserAsStream(options) };
