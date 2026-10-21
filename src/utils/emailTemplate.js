/**
 * Email template and formatting utilities for Email Campaign Manager.
 * Generates responsive, clean multipart (HTML + plain text fallback) emails
 * with legitimate headers and unsubscribe mechanisms.
 */

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Converts a raw text or simple HTML string into clean paragraph HTML.
 */
function textToHtmlParagraphs(text) {
  if (!text || typeof text !== 'string') return '';
  // Normalize line breaks
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const paragraphs = normalized.split(/\n{2,}/);

  return paragraphs
    .map((p) => {
      const trimmed = p.trim();
      if (!trimmed) return '';
      // Escape HTML special characters
      const escaped = escapeHtml(trimmed);
      // Turn single line breaks into <br/>
      const withBreaks = escaped.replace(/\n/g, '<br/>');
      return `<p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #2d3748;">${withBreaks}</p>`;
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * Strips HTML tags and decodes entities to create a readable plain text fallback.
 */
function htmlToPlainText(html) {
  if (!html || typeof html !== 'string') return '';

  return html
    // Replace <br> and closing tags of block elements with newlines
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    // Remove all remaining tags
    .replace(/<[^>]+>/g, '')
    // Decode common entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Clean up excessive whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Builds a responsive, professional multipart email (HTML + Plain text).
 * 
 * @param {Object} options
 * @param {string} options.senderName
 * @param {string} options.subject
 * @param {string} options.content - The body content (plain text or markdown/text)
 * @param {string} [options.unsubscribeUrl] - Working HTTP unsubscribe link
 * @param {string} [options.campaignId]
 * @returns {{ html: string, text: string }}
 */
function buildCampaignEmailTemplate(options) {
  const { senderName, subject, content, unsubscribeUrl } = options || {};

  const safeSenderName = escapeHtml(senderName || 'Email Campaign Manager');
  const safeSubject = escapeHtml(subject || 'Notification');
  const bodyHtml = textToHtmlParagraphs(content || '');

  const unsubscribeHtml = unsubscribeUrl
    ? `<p style="margin: 16px 0 0 0; font-size: 12px; line-height: 1.5; color: #718096; text-align: center;">
         You received this email because your email address was included in this campaign.
         <br/>
         If you no longer wish to receive these emails, you can 
         <a href="${escapeHtml(unsubscribeUrl)}" style="color: #4a5568; text-decoration: underline;">unsubscribe here</a>.
       </p>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeSubject}</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td {font-family: Arial, Helvetica, sans-serif !important;}
  </style>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #f7fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f7fafc; min-height: 100vh;">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);">
          <!-- Header -->
          <tr>
            <td style="padding: 24px 32px; background-color: #ffffff; border-bottom: 1px solid #edf2f7;">
              <span style="font-size: 16px; font-weight: 700; color: #1a202c; letter-spacing: -0.2px;">${safeSenderName}</span>
            </td>
          </tr>
          <!-- Body Content -->
          <tr>
            <td style="padding: 32px; background-color: #ffffff;">
              <h1 style="margin: 0 0 20px 0; font-size: 20px; font-weight: 600; color: #1a202c; line-height: 1.4;">${safeSubject}</h1>
              ${bodyHtml}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; background-color: #f8fafc; border-top: 1px solid #edf2f7;">
              <p style="margin: 0; font-size: 12px; color: #a0aec0; text-align: center;">
                Sent via Email Campaign Manager on behalf of ${safeSenderName}
              </p>
              ${unsubscribeHtml}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  // Generate plain text version
  let text = (content || '').trim();
  if (unsubscribeUrl) {
    text += `\n\n---\nTo unsubscribe from future emails, please visit:\n${unsubscribeUrl}`;
  }

  return { html, text };
}

module.exports = {
  escapeHtml,
  textToHtmlParagraphs,
  htmlToPlainText,
  buildCampaignEmailTemplate,
};
