exports.rex = (req, res) => {
  // Podrías redirigir o simplemente mostrar un botón que abre Rex+ en otra pestaña
  res.render('sistemas/rex', {
    titulo: 'Rex+'
  });
};

exports.ticketera = (req, res) => {
  res.render('sistemas/ticketera', {
    titulo: 'Ticketera'
  });
};
