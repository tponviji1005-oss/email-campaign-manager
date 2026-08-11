// Express 4 does not forward rejected promises from async route handlers to the
// error-handling middleware: an async throw becomes an unhandled promise
// rejection and the request is left hanging with no response. This wrapper
// forwards any rejection to next(err) so it lands in the central error handler
// and is answered with a consistent, sanitized JSON response in every mode.
function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
