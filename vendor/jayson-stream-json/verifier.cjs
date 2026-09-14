// Returning the patched verifier stream preserves Jayson's `new Verifier(options)` call.
const { default: verifier } = require('stream-json-current/utils/verifier.js');
module.exports = function Verifier(options) { return verifier.asStream(options); };
