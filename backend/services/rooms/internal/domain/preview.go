package domain

import (
	"context"
	"io"
)

// PresentationPreview son los metadatos del servicio presentations para mostrar la galería.
// Las URLs se construyen en la API con el grupo, para que pasen por el control de acceso.
type PresentationPreview struct {
	PresentationID string         `json:"presentation_id"`
	SlideCount     int            `json:"slide_count"`
	Slides         []SlidePreview `json:"slides"`
}

type SlidePreview struct {
	Slide int    `json:"slide"`
	File  string `json:"file"`
}

// SlideImage es una imagen del servicio presentations, lista para ser servida por rooms.
type SlideImage struct {
	ContentType string
	Body        io.ReadCloser
}

// GroupPreview devuelve la galería de una presentación asignada al grupo, solo a sus integrantes.
// El anfitrión conforma la sala: si no está en el grupo, no puede espiar sus diapositivas.
func (s *Service) GroupPreview(ctx context.Context, callerID, groupID uint, presentationID string) (PresentationPreview, error) {
	if err := s.checkPreviewAccess(ctx, callerID, groupID, presentationID); err != nil {
		return PresentationPreview{}, err
	}
	return s.catalog.Preview(ctx, presentationID)
}

// GroupSlide sirve una imagen de esa misma presentación, con la misma restricción.
func (s *Service) GroupSlide(ctx context.Context, callerID, groupID uint, presentationID, slideID string) (SlideImage, error) {
	if err := s.checkPreviewAccess(ctx, callerID, groupID, presentationID); err != nil {
		return SlideImage{}, err
	}
	return s.catalog.SlideImage(ctx, presentationID, slideID)
}

func (s *Service) checkPreviewAccess(ctx context.Context, callerID, groupID uint, presentationID string) error {
	if callerID == 0 {
		return ErrUnauthenticated
	}
	if _, err := s.store.GetGroup(ctx, groupID); err != nil {
		return err
	}
	if _, err := s.store.GetPresentation(ctx, groupID, presentationID); err != nil {
		return err
	}
	members, err := s.store.GroupMembers(ctx, groupID)
	if err != nil {
		return err
	}
	for _, m := range members {
		if m.ID == callerID {
			return nil
		}
	}
	return ErrForbidden
}
