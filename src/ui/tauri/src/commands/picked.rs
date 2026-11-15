//! Files the system file picker hands back, made into files the app can read.

/// A picked file, as the composer stages it.
#[derive(Debug, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PickedFile {
    /// A path on disk the uploader, the size and the preview can all read.
    pub file_path: String,
    /// The file's own name, which decides whether it is shown as a picture.
    pub filename: String,
}

/// Make `path`, as the file picker returned it, into a file on disk.
///
/// On Android the picker answers with a `content://` address: no path at all,
/// and a last segment that is a document id rather than the file's name. That
/// one is copied into the app's cache under the name its provider reports.
/// Anywhere else the picker already returned a path, which comes back as it
/// was, with its own last segment for a name.
#[tauri::command]
pub(crate) async fn resolve_picked_file(
    app: tauri::AppHandle,
    path: String,
) -> Result<PickedFile, String> {
    #[cfg(target_os = "android")]
    if path.starts_with("content://") {
        use tauri::Manager;
        let handle = app.state::<crate::platform::android::picked_files::PickedFilesHandle>();
        let copy = crate::platform::android::picked_files::local_copy(&handle, &path).await?;
        return Ok(PickedFile {
            file_path: copy.path,
            filename: copy.name,
        });
    }
    let _ = &app;
    Ok(as_picked(path))
}

/// A path that is already a path, named by its last segment.
fn as_picked(path: String) -> PickedFile {
    let filename = path
        .replace('\\', "/")
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or("file")
        .to_owned();
    PickedFile {
        file_path: path,
        filename,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_path_is_named_by_its_last_segment_on_either_separator() {
        assert_eq!(as_picked(r"C:\pics\cat.png".to_owned()).filename, "cat.png");
        assert_eq!(as_picked("/home/a/dog.jpg".to_owned()).filename, "dog.jpg");
        assert_eq!(as_picked("/trailing/".to_owned()).filename, "file");
    }
}
