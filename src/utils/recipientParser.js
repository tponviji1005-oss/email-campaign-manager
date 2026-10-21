const { validateEmail } = require('./emailValidator');
const { validateMX, extractDomain } = require('./mxValidator');

const EMPTY_RESULT = {
  validRecipients: [],
  invalidRecipients: [],
  totalValid: 0,
  totalInvalid: 0,
};

const DOMAIN_CONCURRENCY = 10;

async function resolveDomainWithFallback(domain, sampleEmail) {
  try {
    return await validateMX(sampleEmail);
  } catch (error) {
    console.warn(
      `DNS verification unavailable for ${domain} (${error.code || error.message}); keeping address valid`
    );
    return true;
  }
}

async function parseRecipients(input) {
  if (typeof input !== 'string') {
    return { ...EMPTY_RESULT };
  }

  const seen = new Set();
  const validSyntaxRecipients = [];
  const invalidRecipients = [];
  const domainToSampleEmail = new Map();

  // Normalize semicolons, commas, and newlines
  for (const part of input.replace(/;/g, ',').split(/[\n,]+/)) {
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
    if (!domain) {
      invalidRecipients.push(recipient);
      continue;
    }

    validSyntaxRecipients.push({ email: recipient, domain });
    if (!domainToSampleEmail.has(domain)) {
      domainToSampleEmail.set(domain, recipient);
    }
  }

  // Resolve unique domains with bounded concurrency
  const uniqueDomains = Array.from(domainToSampleEmail.keys());
  const domainValidity = new Map();

  for (let i = 0; i < uniqueDomains.length; i += DOMAIN_CONCURRENCY) {
    const batch = uniqueDomains.slice(i, i + DOMAIN_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (domain) => {
        const sampleEmail = domainToSampleEmail.get(domain);
        const isValid = await resolveDomainWithFallback(domain, sampleEmail);
        return { domain, isValid };
      })
    );
    for (const res of batchResults) {
      domainValidity.set(res.domain, res.isValid);
    }
  }

  const validRecipients = [];
  for (const item of validSyntaxRecipients) {
    if (domainValidity.get(item.domain)) {
      validRecipients.push(item.email);
    } else {
      invalidRecipients.push(item.email);
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
