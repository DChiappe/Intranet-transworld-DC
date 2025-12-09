const path = require('path');
const fs = require('fs');

function cargarCumpleanios() {
  const dataPath = path.join(__dirname, '..', 'data', 'cumpleanios.json');
  const raw = fs.readFileSync(dataPath, 'utf8');
  return JSON.parse(raw);
}

exports.organigrama = (req, res) => {
  res.render('personas/organigrama', {
    titulo: 'Organigrama'
  });
};

exports.beneficios = (req, res) => {
  // Más adelante puedes leer de beneficios.json
  res.render('personas/beneficios', {
    titulo: 'Beneficios'
  });
};

exports.cumpleaniosLista = (req, res) => {
  const cumpleanios = cargarCumpleanios();
  res.render('personas/cumpleanios', {
    titulo: 'Cumpleaños',
    cumpleanios
  });
};
