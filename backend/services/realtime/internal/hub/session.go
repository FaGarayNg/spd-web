package hub

import (
	"encoding/json"
	"fmt"
	"strconv"
	"time"
)

// Action es el tipo de orden del presentador.
type Action string

const (
	ActionNext Action = "next" // siguiente diapositiva (se detiene en la última)
	ActionPrev Action = "prev" // anterior (se detiene en la primera)
	ActionGoto Action = "goto" // ir a Command.Slide
)

// Command es una orden del presentador. Slide (empezando en 1) solo se usa con ActionGoto.
type Command struct {
	Action Action
	Slide  int
}

// SlideState es el estado de una presentación en vivo: lo reciben los visores por WebSocket y
// lo devuelve el endpoint de control.
type SlideState struct {
	Type           string   `json:"type"` // siempre "slide"
	PresentationID string   `json:"presentation_id"`
	Slide          int      `json:"slide"` // diapositiva actual, empezando en 1 (001.png)
	SlideCount     int      `json:"slide_count"`
	URL            string   `json:"url"` // ruta pública de la imagen actual
	Annotations    []Stroke `json:"annotations"`
}

// SlideURL devuelve la ruta pública (a través del gateway) de la imagen de una diapositiva.
func SlideURL(presentationID string, slide int) string {
	return "/api/presentations/" + presentationID + "/slides/" + strconv.Itoa(slide)
}

// session es el estado de UNA presentación en vivo. Solo la goroutine Run del Hub lo toca.
type session struct {
	id         string
	slide      int // diapositiva actual (empieza en 1)
	slideCount int
	clients     map[*Client]struct{}
	annotations []Stroke // anotaciones de la diapositiva actual; se limpian al cambiar de slide
	lastActive  time.Time

	// payload es el SlideState actual ya serializado: se calcula una vez por cambio (no una
	// vez por visor) y todos los buzones comparten el mismo slice, que es de solo lectura.
	payload []byte
}

func newSession(id string, slideCount int, now time.Time) *session {
	s := &session{
		id:          id,
		slide:       1,
		slideCount:  slideCount,
		clients:     make(map[*Client]struct{}),
		annotations: []Stroke{},
		lastActive:  now,
	}
	s.encode()
	return s
}

func (s *session) state() SlideState {
	annotations := s.annotations
	if annotations == nil {
		annotations = []Stroke{}
	}
	return SlideState{
		Type:           "slide",
		PresentationID: s.id,
		Slide:          s.slide,
		SlideCount:     s.slideCount,
		URL:            SlideURL(s.id, s.slide),
		Annotations:    annotations,
	}
}

func (s *session) encode() {
	payload, err := json.Marshal(s.state())
	if err != nil {
		panic(fmt.Sprintf("hub: no se pudo serializar SlideState: %v", err)) // imposible: tipos simples
	}
	s.payload = payload
}

// apply ejecuta el comando y devuelve si la diapositiva actual cambió. next/prev se detienen
// en los extremos (no dan la vuelta); goto fuera de rango es un error y no altera el estado.
func (s *session) apply(cmd Command) (bool, error) {
	target := s.slide
	switch cmd.Action {
	case ActionNext:
		target = min(s.slide+1, s.slideCount)
	case ActionPrev:
		target = max(s.slide-1, 1)
	case ActionGoto:
		if cmd.Slide < 1 || cmd.Slide > s.slideCount {
			return false, fmt.Errorf("%w: %d (la presentación tiene %d)", ErrSlideOutOfRange, cmd.Slide, s.slideCount)
		}
		target = cmd.Slide
	default:
		return false, fmt.Errorf("%w: %q", ErrUnknownAction, cmd.Action)
	}
	if target == s.slide {
		return false, nil
	}
	s.slide = target
	// Cada diapositiva arranca limpia: el dibujo no se arrastra al pasar de página.
	s.annotations = []Stroke{}
	s.encode()
	return true, nil
}

// broadcast deposita el estado actual en el buzón de cada visor de ESTA sesión. Nunca bloquea:
// un visor lento no puede frenar al Hub ni a los demás visores (ver Client.offer).
func (s *session) broadcast() {
	for c := range s.clients {
		c.offer(s.payload)
	}
}

// applyAnnotation actualiza los trazos y devuelve el estado serializado ya difundible. Cada
// trazo se identifica por id: los envíos parciales reemplazan al anterior, no se acumulan.
func (s *session) applyAnnotation(cmd AnnotationCommand) error {
	if err := cmd.validate(); err != nil {
		return err
	}
	switch cmd.Type {
	case "clear":
		s.annotations = []Stroke{}
	case "annotation":
		in := *cmd.Annotation
		in.Points = append([]StrokePoint(nil), in.Points...)
		for i := range s.annotations {
			if s.annotations[i].ID == in.ID {
				s.annotations[i] = in
				s.encode()
				return nil
			}
		}
		if len(s.annotations) >= maxStrokes {
			s.annotations = s.annotations[1:]
		}
		s.annotations = append(s.annotations, in)
	}
	s.encode()
	return nil
}
