const EMAIL_REGEX = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

function validateEmail(email) {
  return typeof email === 'string' && EMAIL_REGEX.test(email);
}

module.exports = { validateEmail };
