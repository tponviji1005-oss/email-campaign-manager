const { validateEmail } = require('./emailValidator');
const { validateMX, extractDomain } = require('./mxValidator');

const EMPTY_RESULT = {
  validRecipients: [],
  invalidRecipients: [],
  totalValid: 0,
  totalInvalid: 0,
};

async function parseRecipients(input) {
  if (typeof input !== 'string') {
    return { ...EMPTY_RESULT };
  }

  const seen = new Set();
  const mxCache = new Map();
  const validRecipients = [];
  const invalidRecipients = [];

  for (const part of input.split(/[\n,]+/)) {
    const recipient = part.trim();
    if (!recipient) continue;

    const key = recipient.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    if (!validateEmail(recipient)) {
      invalidRecipients.push(recipient);
      continue;
    }

    const domain = extractDomain(recipient);
    let mxPromise = mxCache.get(domain);
    if (mxPromise === undefined) {
      mxPromise = validateMX(recipient);
      mxCache.set(domain, mxPromise);
    }

    const hasMX = await mxPromise;
    if (hasMX) {
      validRecipients.push(recipient);
    } else {
      invalidRecipients.push(recipient);
    }
  }

  return {
    validRecipients,
    invalidRecipients,
    totalValid: validRecipients.length,
    totalInvalid: invalidRecipients.length,
  };
}

module.exports = { parseRecipients };
