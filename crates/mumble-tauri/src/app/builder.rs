//! Construct the base Tauri builder with all plugins registered (the
//! per-platform plugin set: store/opener/notification/dialog/deep-link
//! everywhere, plus Android service plugins or the desktop window-state /
//! global-shortcut / updater plugins).

#[cfg(target_os = "android")]
use tauri::Manager;

pub(crate) fn create_base_builder() -> tauri::Builder<tauri::Wry> {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init());

    #[cfg(target_os = "android")]
    let builder = builder.plugin(
        tauri::plugin::Builder::<tauri::Wry, ()>::new("connection-service")
            .setup(|app, api| {
                let handle =
                    api.register_android_plugin("com.fancymumble.app", "ConnectionServicePlugin")?;
                let cs_handle =
                    crate::platform::android::connection_service::ConnectionServiceHandle(handle);
                crate::platform::android::connection_service::register_disconnect_listener(
                    &cs_handle,
                    app.clone(),
                );
                crate::platform::android::connection_service::register_navigate_listener(
                    &cs_handle,
                    app.clone(),
                );
                let _ = app.manage(cs_handle);
                Ok(())
            })
            .build(),
    );

    #[cfg(target_os = "android")]
    let builder = builder.plugin(
        tauri::plugin::Builder::<tauri::Wry, ()>::new("fcm-service")
            .setup(|app, api| {
                let handle = api.register_android_plugin("com.fancymumble.app", "FcmPlugin")?;
                let fcm_handle = crate::platform::android::fcm_service::FcmPluginHandle(handle);
                let _ = app.manage(fcm_handle);
                Ok(())
            })
            .build(),
    );

    // The plugin only writes its cache on a clean exit; `window_state` also
    // persists it as the geometry changes, so a `tauri dev` restart or a crash
    // doesn't resurrect the geometry from the last graceful shutdown.
    #[cfg(not(target_os = "android"))]
    let builder = builder.plugin(
        tauri_plugin_window_state::Builder::new()
            .with_state_flags(crate::app::window_state::state_flags())
            .with_denylist(&crate::app::window_state::DENYLIST)
            .build(),
    );

    #[cfg(not(target_os = "android"))]
    let builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());

    #[cfg(not(target_os = "android"))]
    let builder = crate::updater::register_plugins(builder);

    builder
}
