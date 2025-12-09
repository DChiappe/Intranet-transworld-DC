exports.procedimientos = (req, res) => {
  res.render('procesos/procedimientos', {
    titulo: 'Procedimientos'
  });
};

exports.protocolos = (req, res) => {
  res.render('procesos/protocolos', {
    titulo: 'Protocolos'
  });
};

exports.reglamento = (req, res) => {
  res.render('procesos/reglamento', {
    titulo: 'Reglamento interno'
  });
};

exports.achs = (req, res) => {
  res.render('procesos/achs', {
    titulo: 'ACHS y procedimientos por accidentes'
  });
};
