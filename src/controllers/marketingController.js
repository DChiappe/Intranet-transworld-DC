exports.eventos = (req, res) => {
  // Más adelante puedes listar imágenes desde una carpeta o BD
  res.render('marketing/eventos', {
    titulo: 'Eventos y Marketing'
  });
};
