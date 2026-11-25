// Package catalog es el cliente HTTP del servicio presentations e implementa domain.Catalog.
// Es la única vía por la que el servicio rooms conoce las presentaciones: los microservicios no
// comparten disco ni base de datos, se comunican por su API.
package catalog

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"spd.web/services/rooms/internal/domain"
)

var _ domain.Catalog = (*Client)(nil)

// Client consulta los metadatos de las presentaciones.
type Client struct {
	base *url.URL
	http *http.Client
}

// New crea un cliente contra base (p. ej. http://localhost:8081) con un timeout por petición.
func New(base *url.URL, timeout time.Duration) *Client {
	return &Client{base: base, http: &http.Client{Timeout: timeout}}
}

// SlideCount devuelve el número de diapositivas consultando GET /api/presentations/{id}.
func (c *Client) SlideCount(ctx context.Context, presentationID string) (int, error) {
	u := c.base.JoinPath("api", "presentations", presentationID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return 0, fmt.Errorf("catálogo de presentaciones: %w", err)
	}
	defer func() {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10)) // permite reutilizar la conexión
		_ = resp.Body.Close()
	}()

	switch resp.StatusCode {
	case http.StatusOK:
	case http.StatusNotFound:
		return 0, domain.ErrPresentationUnknown
	default:
		return 0, fmt.Errorf("catálogo de presentaciones: respuesta inesperada %s", resp.Status)
	}

	// Lector tolerante: solo interesa slide_count; el resto de campos se ignora.
	var body struct {
		SlideCount int `json:"slide_count"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&body); err != nil {
		return 0, fmt.Errorf("catálogo de presentaciones: respuesta inválida: %w", err)
	}
	if body.SlideCount < 1 {
		return 0, fmt.Errorf("catálogo de presentaciones: slide_count inválido (%d)", body.SlideCount)
	}
	return body.SlideCount, nil
}

// Preview trae los metadatos y la lista de diapositivas del servicio presentations.
func (c *Client) Preview(ctx context.Context, presentationID string) (domain.PresentationPreview, error) {
	u := c.base.JoinPath("api", "presentations", presentationID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return domain.PresentationPreview{}, err
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return domain.PresentationPreview{}, fmt.Errorf("catálogo de presentaciones: %w", err)
	}
	defer func() {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
		_ = resp.Body.Close()
	}()
	switch resp.StatusCode {
	case http.StatusOK:
	case http.StatusNotFound:
		return domain.PresentationPreview{}, domain.ErrPresentationUnknown
	default:
		return domain.PresentationPreview{}, fmt.Errorf("catálogo de presentaciones: respuesta inesperada %s", resp.Status)
	}

	var body struct {
		PresentationID string `json:"presentation_id"`
		SlideCount     int    `json:"slide_count"`
		Slides         []struct {
			Slide int    `json:"slide"`
			File  string `json:"file"`
		} `json:"slides"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&body); err != nil {
		return domain.PresentationPreview{}, fmt.Errorf("catálogo de presentaciones: respuesta inválida: %w", err)
	}
	out := domain.PresentationPreview{PresentationID: body.PresentationID, SlideCount: body.SlideCount,
		Slides: make([]domain.SlidePreview, 0, len(body.Slides))}
	for _, s := range body.Slides {
		out.Slides = append(out.Slides, domain.SlidePreview{Slide: s.Slide, File: s.File})
	}
	return out, nil
}

// SlideImage trae una imagen del servicio presentations. El llamador debe cerrar el Body.
func (c *Client) SlideImage(ctx context.Context, presentationID, slideID string) (domain.SlideImage, error) {
	u := c.base.JoinPath("api", "presentations", presentationID, "slides", slideID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return domain.SlideImage{}, err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return domain.SlideImage{}, fmt.Errorf("catálogo de presentaciones: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
		_ = resp.Body.Close()
		if resp.StatusCode == http.StatusNotFound {
			return domain.SlideImage{}, domain.ErrPresentationUnknown
		}
		return domain.SlideImage{}, fmt.Errorf("catálogo de presentaciones: respuesta inesperada %s", resp.Status)
	}
	return domain.SlideImage{ContentType: resp.Header.Get("Content-Type"), Body: resp.Body}, nil
}
