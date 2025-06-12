/**
 * Health Check Endpoint
 * Returns the health and uptime of the service.
 */
module.exports = async (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    serverTime: new Date().toISOString(),
  });
}; 