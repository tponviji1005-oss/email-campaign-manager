function requireAuth(req, res, next) {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  next();
}

module.exports = { requireAuth };
