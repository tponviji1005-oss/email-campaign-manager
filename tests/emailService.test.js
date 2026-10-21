const { test, describe, mock } = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const { sendEmail, setTransporter } = require('../src/services/email.service');
const { buildCampaignEmailTemplate } = require('../src/utils/emailTemplate');

describe('Email Service Headers & Mocked Delivery', () => {
  test('sendEmail passes HTML, text, Reply-To, and RFC List-Unsubscribe headers to transporter', async () => {
    let capturedMailOptions = null;

    setTransporter({
      sendMail: async (options) => {
        capturedMailOptions = options;
        return { messageId: '<test-message-123@smtp.local>' };
      },
    });

    try {
      const template = buildCampaignEmailTemplate({
        senderName: 'Campus Alerts',
        subject: 'Important Announcement',
        content: 'Classes begin tomorrow at 9 AM.',
        unsubscribeUrl: 'http://localhost:3000/unsubscribe?email=test%40college.edu&token=abc',
      });

      const headers = {
        'List-Unsubscribe': '<http://localhost:3000/unsubscribe?email=test%40college.edu&token=abc>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        'X-Campaign-Id': 'camp-123',
      };

      await sendEmail({
        from: '"Campus Alerts" <admin@college.edu>',
        to: 'student@college.edu',
        subject: 'Important Announcement',
        text: template.text,
        html: template.html,
        replyTo: 'support@college.edu',
        headers,
      });

      assert.ok(capturedMailOptions !== null);
      assert.strictEqual(capturedMailOptions.from, '"Campus Alerts" <admin@college.edu>');
      assert.strictEqual(capturedMailOptions.to, 'student@college.edu');
      assert.strictEqual(capturedMailOptions.subject, 'Important Announcement');
      assert.strictEqual(capturedMailOptions.replyTo, 'support@college.edu');
      assert.ok(capturedMailOptions.html.includes('Important Announcement'));
      assert.ok(capturedMailOptions.text.includes('Classes begin tomorrow'));
      assert.strictEqual(
        capturedMailOptions.headers['List-Unsubscribe'],
        '<http://localhost:3000/unsubscribe?email=test%40college.edu&token=abc>'
      );
      assert.strictEqual(
        capturedMailOptions.headers['List-Unsubscribe-Post'],
        'List-Unsubscribe=One-Click'
      );
    } finally {
      setTransporter(null);
    }
  });

  test('sendEmail fails fast when required fields are missing', async () => {
    await assert.rejects(
      async () => sendEmail({ from: '', to: 'a@b.com', subject: 'Hi', text: 'Hey' }),
      /Email options.from is required/
    );

    await assert.rejects(
      async () => sendEmail({ from: 'a@b.com', to: '', subject: 'Hi', text: 'Hey' }),
      /Email options.to is required/
    );

    await assert.rejects(
      async () => sendEmail({ from: 'a@b.com', to: 'b@b.com', subject: '', text: 'Hey' }),
      /Email options.subject is required/
    );

    await assert.rejects(
      async () => sendEmail({ from: 'a@b.com', to: 'b@b.com', subject: 'Hi' }),
      /Email options.text or options.html is required/
    );
  });
});
