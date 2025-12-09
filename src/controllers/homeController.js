const path = require('path');
const fs = require('fs');

function obtenerUsdDelDiaMock() {
  // Más adelante se puede reemplazar por una API real
  return 950.50; // valor de ejemplo
}

function cargarCumpleanios() {
  const dataPath = path.join(__dirname, '..', 'data', 'cumpleanios.json');
  const raw = fs.readFileSync(dataPath, 'utf8');
  const lista = JSON.parse(raw);

  const hoy = new Date();
  const mes = hoy.getMonth() + 1;
  const dia = hoy.getDate();

  const cumpleaniosHoy = lista.filter(
    (p) => p.mes === mes && p.dia === dia
  );

  return cumpleaniosHoy;
}

exports.home = (req, res) => {
  const usdHoy = obtenerUsdDelDiaMock();
  const cumpleaniosHoy = cargarCumpleanios();

  res.render('home', {
    titulo: 'Inicio',
    usdHoy,
    cumpleaniosHoy
  });
};
