const dns = require('node:dns').promises;

const DEFINITIVE_NO_RECORD_CODES = new Set(['ENOTFOUND', 'ENODATA', 'NODATA']);

function extractDomain(email) {
  if (typeof email !== 'string') return '';
  const atIndex = email.lastIndexOf('@');
  if (atIndex === -1) return '';
  return email.slice(atIndex + 1).toLowerCase();
}

function hasNullMx(mxRecords) {
  return (
    Array.isArray(mxRecords) &&
    mxRecords.length > 0 &&
    mxRecords.every((record) => !record.exchange)
  );
}

async function hasAddressRecord(domain) {
  for (const lookup of [dns.resolve4.bind(dns), dns.resolve6.bind(dns)]) {
    try {
      const addresses = await lookup(domain);
      if (Array.isArray(addresses) && addresses.length > 0) return true;
    } catch (error) {
      if (!DEFINITIVE_NO_RECORD_CODES.has(error.code)) throw error;
    }
  }
  return false;
}

async function validateMX(email) {
  const domain = extractDomain(email);
  if (!domain) return false;

  let mxRecords;
  try {
    mxRecords = await dns.resolveMx(domain);
  } catch (error) {
    if (!DEFINITIVE_NO_RECORD_CODES.has(error.code)) throw error;
    mxRecords = [];
  }

  if (hasNullMx(mxRecords)) return false;
  if (Array.isArray(mxRecords) && mxRecords.length > 0) return true;

  return hasAddressRecord(domain);
}

module.exports = { validateMX, extractDomain };
