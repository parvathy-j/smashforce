// Route moved into server.js to eliminate circular dependency.
// This file is kept so existing require('./api-booked-slots') calls don't crash.
const express = require("express");
const router = express.Router();
module.exports = router;
