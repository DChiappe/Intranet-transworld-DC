// email-listener.js
//
// Escucha el buzón IMAP del correo de soporte
// y crea un ticket nuevo en la tabla `tickets` por cada correo entrante.

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const db = require('./db'); // ajusta la ruta si tu db.js está en otra carpeta

async function main() {
  const client = new ImapFlow({
    host: process.env.IMAP_HOST || 'outlook.office365.com',
    port: process.env.IMAP_PORT ? Number(process.env.IMAP_PORT) : 993,
    secure: true,
    auth: {
      user: process.env.IMAP_USER || 'dchiappe@transworld.cl', // correo de soporte
      pass: process.env.IMAP_PASS || 'X@533442674582uh'                    // contraseña real o app password
    }
  });

  console.log('Conectando a IMAP...');
  await client.connect();
  console.log('Conectado a IMAP.');

  // Abrimos INBOX para escuchar nuevos correos
  await client.mailboxOpen('INBOX');
  console.log('INBOX abierto. Esperando nuevos correos...');

  // Este evento se dispara cuando cambia el número de mensajes (nuevo correo)
  client.on('exists', async () => {
    try {
      const seq = client.mailbox.exists; // último mensaje
      const message = await client.fetchOne(seq, { source: true });

      const parsed = await simpleParser(message.source);

      // Extraer datos del correo
      const from = parsed.from && parsed.from.value && parsed.from.value[0];
      const solicitante_email = from ? from.address : null;
      const solicitante_nombre = from ? (from.name || from.address) : null;

      const titulo = (parsed.subject || '(sin asunto)').substring(0, 255);
      const descripcion =
        parsed.text || parsed.html || '(sin contenido en el correo)';

      const categoria = 'Otro';
      const prioridad = 'Media';
      const estado = 'Abierto';

      if (!solicitante_email) {
        console.log(
          'Correo recibido sin remitente válido, no se crea ticket.'
        );
        return;
      }

      // Insertar ticket en la BD
      db.query(
        `
        INSERT INTO tickets (
          titulo,
          descripcion,
          
          categoria,
          prioridad,
          estado,
          solicitante_nombre,
          solicitante_email
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
        [
          titulo,
          descripcion,
          categoria,
          prioridad,
          estado,
          solicitante_nombre,
          solicitante_email
        ],
        (err, result) => {
          if (err) {
            console.error('Error insertando ticket desde email:', err);
          } else {
            console.log(
              `Ticket creado desde email. ID: ${result.insertId}, remitente: ${solicitante_email}`
            );
          }
        }
      );
    } catch (err) {
      console.error('Error procesando nuevo correo:', err);
    }
  });

  // Manejo básico de errores del cliente IMAP
  client.on('error', (err) => {
    console.error('Error en cliente IMAP:', err);
  });
}

main().catch((err) => {
  console.error('Error iniciando email-listener:', err);
});
