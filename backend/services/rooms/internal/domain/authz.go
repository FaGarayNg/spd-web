package domain

import "fmt"

// Autorización sobre una sala. La identidad llega en la cabecera Authorization (JWT que el
// propio servicio verifica); sin identidad es ErrUnauthenticated (401) y con identidad sin
// permiso, ErrForbidden (403). El dueño de la sala es su anfitrión.
//
// checkOwner exige que la acción la haga el dueño de la sala: administrarla, armar grupos,
// lanzar o terminar la sesión en vivo, desasignar presentaciones. Salas sin dueño (OwnerID 0,
// las de antes del login): nadie las administra por la API.
func checkOwner(r Room, callerID uint) error {
	switch {
	case callerID == 0:
		return ErrUnauthenticated
	case r.OwnerID != callerID:
		return ErrForbidden
	}
	return nil
}

// checkMember exige dueño o miembro de la sala: las acciones de integrante, como asignar la
// presentación del propio grupo.
func checkMember(r Room, callerID uint, member bool) error {
	switch {
	case callerID == 0:
		return ErrUnauthenticated
	case r.OwnerID == callerID || member:
		return nil
	}
	return fmt.Errorf("%w: tenés que ser miembro de la sala", ErrForbidden)
}
