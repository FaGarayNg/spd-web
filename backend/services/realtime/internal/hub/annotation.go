package hub

import (
	"errors"
	"math"
)

// Anotaciones compartidas sobre la diapositiva. Las coordenadas usan el espacio fijo del canvas
// (1280x720), así que cualquier tamaño de pantalla dibuja lo mismo. Cada mensaje trae el trazo
// COMPLETO hasta ese momento: el Hub lo reemplaza por su id y difunde el estado total, igual que
// hace con la diapositiva. Un visor lento se salta intermedios pero siempre ve el último estado.
type StrokePoint struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type Stroke struct {
	ID     string        `json:"id"`
	Color  string        `json:"color"`
	Width  int           `json:"width"`
	Eraser bool          `json:"eraser"`
	Points []StrokePoint `json:"points"`
}

// AnnotationCommand es lo que el presentador manda por el WebSocket.
//  - type "annotation": upsert del trazo (por id) en la diapositiva actual.
//  - type "clear": borra todas las anotaciones de la diapositiva actual.
type AnnotationCommand struct {
	Type       string  `json:"type"`
	Annotation *Stroke `json:"annotation,omitempty"`
}

var ErrInvalidAnnotation = errors.New("anotación inválida")

const (
	maxStrokes         = 200
	maxPointsPerStroke = 2000
	maxCoord           = 10000
	maxColorLen        = 32
	maxIDLen           = 64
)

func (c AnnotationCommand) validate() error {
	switch c.Type {
	case "clear":
		return nil
	case "annotation":
		s := c.Annotation
		if s == nil || len(s.ID) == 0 || len(s.ID) > maxIDLen ||
			len(s.Color) == 0 || len(s.Color) > maxColorLen ||
			s.Width < 1 || s.Width > 40 ||
			len(s.Points) == 0 || len(s.Points) > maxPointsPerStroke {
			return ErrInvalidAnnotation
		}
		for _, p := range s.Points {
			if math.IsNaN(p.X) || math.IsInf(p.X, 0) || math.IsNaN(p.Y) || math.IsInf(p.Y, 0) ||
				math.Abs(p.X) > maxCoord || math.Abs(p.Y) > maxCoord {
				return ErrInvalidAnnotation
			}
		}
		return nil
	default:
		return ErrInvalidAnnotation
	}
}
