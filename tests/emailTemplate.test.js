const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  escapeHtml,
  textToHtmlParagraphs,
  htmlToPlainText,
  buildCampaignEmailTemplate,
} = require('../src/utils/emailTemplate');
const {
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribeUrl,
} = require('../src/services/unsubscribe.service');

describe('Email Formatting & Template Engine', () => {
  test('escapeHtml properly sanitizes dangerous characters to prevent injection', () => {
    const raw = '<script>alert("xss")</script> & "quotes" \'apostrophe\'';
    const escaped = escapeHtml(raw);
    assert.strictEqual(
      escaped,
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &quot;quotes&quot; &#39;apostrophe&#39;'
    );
  });

  test('textToHtmlParagraphs wraps content into clean styled paragraphs with preserved line breaks', () => {
    const input = 'Hello world\nThis is line two\n\nSecond paragraph';
    const html = textToHtmlParagraphs(input);
    assert.match(html, /<p style=".*">Hello world<br\/>This is line two<\/p>/);
    assert.match(html, /<p style=".*">Second paragraph<\/p>/);
  });

  test('htmlToPlainText strips tags and decodes entities properly', () => {
    const html = '<p>Hello &amp; welcome!<br/>Line 2</p><p>Second paragraph</p>';
    const text = htmlToPlainText(html);
    assert.match(text, /Hello & welcome!/);
    assert.match(text, /Line 2/);
    assert.match(text, /Second paragraph/);
  });

  test('buildCampaignEmailTemplate returns responsive HTML and readable plain text fallback', () => {
    const template = buildCampaignEmailTemplate({
      senderName: 'Acme Corp',
      subject: 'Welcome to Acme',
      content: 'Hello customer,\nThank you for choosing Acme.',
      unsubscribeUrl: 'https://example.com/unsubscribe?email=test%40example.com&token=123',
    });

    assert.ok(template.html.includes('<!DOCTYPE html>'));
    assert.ok(template.html.includes('Acme Corp'));
    assert.ok(template.html.includes('Welcome to Acme'));
    // In HTML attributes & is escaped to &amp;
    assert.ok(template.html.includes('https://example.com/unsubscribe?email=test%40example.com&amp;token=123'));
    assert.ok(template.text.includes('Hello customer,'));
    assert.ok(template.text.includes('To unsubscribe from future emails'));
  });
});

describe('Unsubscribe HMAC and URL Generation', () => {
  test('generateUnsubscribeToken and verifyUnsubscribeToken validate signatures correctly', () => {
    const email = 'student@college.edu';
    const token = generateUnsubscribeToken(email);

    assert.ok(typeof token === 'string' && token.length === 64);
    assert.strictEqual(verifyUnsubscribeToken(email, token), true);
    assert.strictEqual(verifyUnsubscribeToken('other@college.edu', token), false);
    assert.strictEqual(verifyUnsubscribeToken(email, 'invalid_token'), false);
  });

  test('buildUnsubscribeUrl creates valid URL with encoded email and token', () => {
    const email = 'user+test@example.com';
    const url = buildUnsubscribeUrl(email);

    assert.ok(url.includes('/unsubscribe?email=user%2Btest%40example.com&token='));
  });
});
