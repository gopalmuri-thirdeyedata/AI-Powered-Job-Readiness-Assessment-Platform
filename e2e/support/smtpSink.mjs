// A tiny local SMTP server (127.0.0.1, random port) that records what the backend submits. Nothing leaves the machine.
// Shared by the e-mail e2e specs. Specs that use it must also pin empty SMTP_USER / SMTP_PASSWORD in the environment, which stops
// backend/.env from supplying real credentials.
import net from 'node:net';

const qpDecode = (s) => s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

export const startSink = () => new Promise((resolve) => {
  const messages = [];
  const refused = new Set();
  const server = net.createServer((sock) => {
    sock.setEncoding('utf8');
    let buf = ''; let inData = false; let from = ''; let rcpt = [];
    const say = (line) => sock.write(`${line}\r\n`);
    say('220 sink ESMTP');
    sock.on('error', () => {});
    sock.on('data', (chunk) => {
      buf += chunk;
      for (;;) {
        if (inData) {
          const end = buf.indexOf('\r\n.\r\n');
          if (end < 0) break;
          const raw = buf.slice(0, end);
          buf = buf.slice(end + 5);
          inData = false;
          messages.push({ from, rcpt: [...rcpt], data: /quoted-printable/i.test(raw) ? qpDecode(raw) : raw });
          say('250 queued');
          continue;
        }
        const eol = buf.indexOf('\r\n');
        if (eol < 0) break;
        const line = buf.slice(0, eol); buf = buf.slice(eol + 2);
        const cmd = line.toUpperCase();
        if (cmd.startsWith('EHLO')) sock.write('250-sink\r\n250 8BITMIME\r\n');
        else if (cmd.startsWith('MAIL FROM')) { from = line; rcpt = []; say('250 ok'); }
        else if (cmd.startsWith('RCPT TO')) {
          const addr = (line.match(/<(.+?)>/) || [])[1];
          if (refused.has(addr)) say('550 5.1.1 mailbox unavailable'); else { rcpt.push(addr); say('250 ok'); }
        } else if (cmd === 'DATA') { inData = true; say('354 go ahead'); }
        else if (cmd === 'QUIT') { say('221 bye'); sock.end(); }
        else say('250 ok');
      }
    });
  });
  server.listen(0, '127.0.0.1', () => resolve({
    port: server.address().port, messages, refused, close: () => server.close(),
    to: (addr) => messages.filter((m) => m.rcpt.includes(addr)),
  }));
});
