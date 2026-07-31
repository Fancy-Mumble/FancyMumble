# Aurora component architecture

The runnable client follows one direction of composition:

1. `AuroraClientApp` owns application state and selects screens and surfaces.
2. Screen components (`OnboardingFlow`, `ServerRail`, `WindowTitleBar`) compose feature components.
3. Feature components (`ChannelRow`, `MemberRow`, `MessageItem`, `LinkPreviews`, and the modal surfaces) compose shared primitives.
4. Primitives (`Button`, `IconButton`, `TextField`, `SelectField`, `ToggleSwitch`, `SearchField`, `ModalSurface`, and `Stepper`) are the only layer that creates native interactive HTML controls.

Rules:

- Do not create `button`, `input`, `textarea`, or `select` elements in controllers, screens, or feature components. Add or extend a primitive first.
- Compose downwards until the leaves are small, atomic, pure-HTML components. A rendered unit with its own copy, layout, or behaviour gets a name rather than being inlined into a parent's JSX.
- Settings is a full-screen surface: `SettingsPanel` passes `className`/`backdropClassName` to `ModalSurface` so it fills the window below the title bar instead of rendering a centered card.
- Keep state and backend calls in controllers or feature components; primitives remain presentation-only.
- Prefer a named component when a rendered unit has its own behavior, repeated styling, accessibility contract, or independent test surface.
- Semantic layout HTML belongs in the smallest feature component that owns its meaning. Avoid meaningless wrapper components around a single `div`.
- The design sheet documents the framework. Runnable examples should import the same primitives used by the client instead of defining parallel controls.
