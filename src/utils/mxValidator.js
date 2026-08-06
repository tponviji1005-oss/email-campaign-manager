const dns = require('node:dns').promises;

function extractDomain(email) {
  if (typeof email !== 'string') return '';
  const atIndex = email.lastIndexOf('@');
  if (atIndex === -1) return '';
  return email.slice(atIndex + 1).toLowerCase();
}

async function validateMX(email) {
  const domain = extractDomain(email);
  if (!domain) return false;

  try {
    const mxRecords = await dns.resolveMx(domain);
    return Array.isArray(mxRecords) && mxRecords.length > 0;
  } catch (error) {
    return false;
  }
}

module.exports = { validateMX, extractDomain };
