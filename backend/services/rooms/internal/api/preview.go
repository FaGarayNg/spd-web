package api

import (
	"fmt"
	"io"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// Preview privado: pasa por rooms, que verifica que quien pide sea integrante del grupo. Las
// imágenes se sirven por la misma ruta, así que no se puede saltar el control con la URL directa.

type previewSlide struct {
	Slide int    `json:"slide"`
	File  string `json:"file"`
	URL   string `json:"url"`
}

type previewResponse struct {
	PresentationID string         `json:"presentation_id"`
	SlideCount     int            `json:"slide_count"`
	Slides         []previewSlide `json:"slides"`
}

func (h *Handler) groupPreview(c *gin.Context) {
	caller, ok := h.requireUser(c)
	if !ok {
		return
	}
	id, ok := idParam(c, "id")
	if !ok {
		return
	}
	presentationID, ok := presentationParam(c)
	if !ok {
		return
	}
	p, err := h.svc.GroupPreview(c.Request.Context(), caller, id, presentationID)
	if err != nil {
		h.fail(c, err)
		return
	}
	base := fmt.Sprintf("/api/groups/%d/presentations/%s", id, presentationID)
	res := previewResponse{PresentationID: p.PresentationID, SlideCount: p.SlideCount,
		Slides: make([]previewSlide, 0, len(p.Slides))}
	for _, s := range p.Slides {
		res.Slides = append(res.Slides, previewSlide{
			Slide: s.Slide, File: s.File, URL: base + "/slides/" + strconv.Itoa(s.Slide),
		})
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) groupSlide(c *gin.Context) {
	caller, ok := h.requireUser(c)
	if !ok {
		return
	}
	id, ok := idParam(c, "id")
	if !ok {
		return
	}
	presentationID, ok := presentationParam(c)
	if !ok {
		return
	}
	img, err := h.svc.GroupSlide(c.Request.Context(), caller, id, presentationID, c.Param("slide_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	defer img.Body.Close()

	contentType := img.ContentType
	if contentType == "" {
		contentType = "image/png"
	}
	c.Header("Content-Type", contentType)
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Cache-Control", "private, max-age=3600")
	_, _ = io.Copy(c.Writer, img.Body)
}
