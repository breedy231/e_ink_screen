const https = require('https');
const { URL } = require('url');

/**
 * Send a Discord notification via webhook.
 * @param {string} webhookUrl - Full Discord webhook URL
 * @param {object} options
 * @param {string} options.title - Embed title
 * @param {string} [options.description] - Embed description
 * @param {number} [options.color] - Embed sidebar color (decimal)
 * @param {Array<{name: string, value: string, inline?: boolean}>} [options.fields]
 * @returns {Promise<void>}
 */
function sendDiscordNotification(webhookUrl, { title, description, color, fields }) {
    return new Promise((resolve, reject) => {
        const embed = { title };
        if (description) embed.description = description;
        if (color != null) embed.color = color;
        if (fields) embed.fields = fields;

        const body = JSON.stringify({ embeds: [embed] });
        const parsed = new URL(webhookUrl);

        const req = https.request({
            hostname: parsed.hostname,
            path: parsed.pathname + parsed.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        }, (res) => {
            // Discord returns 204 on success
            if (res.statusCode >= 200 && res.statusCode < 300) {
                resolve();
            } else {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => reject(new Error(`Discord webhook ${res.statusCode}: ${data}`)));
            }
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

module.exports = { sendDiscordNotification };
