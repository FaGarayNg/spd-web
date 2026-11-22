package store_test

import (
	"errors"
	"testing"
	"time"

	"gorm.io/gorm"

	"spd.web/services/rooms/internal/domain"
)

// Tests de la sesión en vivo en la base de datos: el reemplazo reinicia StartedAt, la fila se
// borra de verdad (sin borrado lógico) y desaparece con la sala (clave foránea).

// backdate atrasa la fila de la sesión en vivo una hora: así el reemplazo se nota sin dormir.
func backdate(t *testing.T, db *gorm.DB, roomID uint) {
	t.Helper()
	if err := db.Exec("UPDATE live_sessions SET created_at = created_at - interval '1 hour' WHERE room_id = ?", roomID).Error; err != nil {
		t.Fatal(err)
	}
}

func TestLiveSessionSetAndGet(t *testing.T) {
	st, _ := newStore(t)
	_, r, _ := fixture(t, st)

	ls, err := st.SetLiveSession(ctx, domain.LiveSession{RoomID: r.ID, PresentationID: pres1})
	if err != nil {
		t.Fatal(err)
	}
	if ls.RoomID != r.ID || ls.PresentationID != pres1 {
		t.Fatalf("SetLiveSession = %+v", ls)
	}
	if time.Since(ls.StartedAt) > time.Minute {
		t.Fatalf("StartedAt no es de ahora: %v", ls.StartedAt)
	}

	got, err := st.LiveSession(ctx, r.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got != ls {
		t.Fatalf("LiveSession = %+v; se esperaba %+v", got, ls)
	}
}

// Lanzar otra presentación reemplaza a la anterior y reinicia el momento de arranque, aunque la
// anterior haya quedado atrasada en la base.
func TestLiveSessionReplaceRestartsStartedAt(t *testing.T) {
	st, db := newStore(t)
	_, r, _ := fixture(t, st)

	first, err := st.SetLiveSession(ctx, domain.LiveSession{RoomID: r.ID, PresentationID: pres1})
	if err != nil {
		t.Fatal(err)
	}
	backdate(t, db, r.ID)

	second, err := st.SetLiveSession(ctx, domain.LiveSession{RoomID: r.ID, PresentationID: pres2})
	if err != nil {
		t.Fatal(err)
	}
	if second.PresentationID != pres2 {
		t.Fatalf("reemplazo = %+v; la presentación no cambió", second)
	}
	if !second.StartedAt.After(first.StartedAt) {
		t.Fatalf("StartedAt no se reinició: %v no es después de %v", second.StartedAt, first.StartedAt)
	}
	if n := count(t, db, "SELECT count(*) FROM live_sessions WHERE room_id = ?", r.ID); n != 1 {
		t.Fatalf("quedaron %d filas de sesión en vivo, se esperaba 1", n)
	}
}

// Sin sesión, la consulta da ErrLiveSessionNotFound; terminar la sesión la borra de verdad y es
// idempotente (finalizar dos veces no es un error).
func TestLiveSessionClearIsIdempotent(t *testing.T) {
	st, db := newStore(t)
	_, r, _ := fixture(t, st)

	if _, err := st.LiveSession(ctx, r.ID); !errors.Is(err, domain.ErrLiveSessionNotFound) {
		t.Fatalf("sin sesión = %v; se esperaba ErrLiveSessionNotFound", err)
	}

	if err := st.ClearLiveSession(ctx, r.ID); err != nil {
		t.Fatal(err) // sin sesión también es éxito
	}
	if _, err := st.SetLiveSession(ctx, domain.LiveSession{RoomID: r.ID, PresentationID: pres1}); err != nil {
		t.Fatal(err)
	}
	if err := st.ClearLiveSession(ctx, r.ID); err != nil {
		t.Fatal(err)
	}
	if err := st.ClearLiveSession(ctx, r.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := st.LiveSession(ctx, r.ID); !errors.Is(err, domain.ErrLiveSessionNotFound) {
		t.Fatalf("tras borrar = %v; se esperaba ErrLiveSessionNotFound", err)
	}
	if n := count(t, db, "SELECT count(*) FROM live_sessions WHERE room_id = ?", r.ID); n != 0 {
		t.Fatalf("quedaron %d filas de sesión en vivo", n)
	}
}

// La fila de la sesión en vivo es física: al borrar la sala desaparece con ella (DeleteRoom la
// limpia explícitamente; la FK también lo haría en un borrado físico), no queda marcada.
func TestLiveSessionCascadesWithRoom(t *testing.T) {
	st, db := newStore(t)
	_, r, _ := fixture(t, st)

	if _, err := st.SetLiveSession(ctx, domain.LiveSession{RoomID: r.ID, PresentationID: pres1}); err != nil {
		t.Fatal(err)
	}
	if err := st.DeleteRoom(ctx, r.ID); err != nil {
		t.Fatal(err)
	}
	if n := count(t, db, "SELECT count(*) FROM live_sessions WHERE room_id = ?", r.ID); n != 0 {
		t.Fatalf("quedaron %d filas de sesión en vivo de una sala borrada", n)
	}
}
