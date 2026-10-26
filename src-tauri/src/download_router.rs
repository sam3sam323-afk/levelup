use crate::models::EngineType;
use reqwest::header::{CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, RANGE};
use reqwest::{Client, StatusCode, Url};
use std::time::Duration;

pub const LARGE_FILE_THRESHOLD_BYTES: u64 = 100 * 1024 * 1024;
const PROBE_TIMEOUT: Duration = Duration::from_secs(4);

#[derive(Debug, Clone, PartialEq, Eq)]
struct RemoteMetadata {
    size_bytes: Option<u64>,
    content_type: Option<String>,
}

pub async fn detect_engine(raw_url: &str) -> EngineType {
    if raw_url.to_ascii_lowercase().starts_with("magnet:") || is_archive_url(raw_url) {
        return EngineType::Aria2c;
    }
    if is_youtube_url(raw_url) {
        return EngineType::YtDlp;
    }

    let metadata = probe_remote_metadata(raw_url).await;
    choose_engine(raw_url, metadata.as_ref())
}

fn choose_engine(raw_url: &str, metadata: Option<&RemoteMetadata>) -> EngineType {
    if raw_url.to_ascii_lowercase().starts_with("magnet:") || is_archive_url(raw_url) {
        return EngineType::Aria2c;
    }
    if is_youtube_url(raw_url) {
        return EngineType::YtDlp;
    }

    if let Some(metadata) = metadata {
        if is_html_page(metadata.content_type.as_deref()) {
            return EngineType::YtDlp;
        }
        if metadata.size_bytes.is_some_and(|size| size >= LARGE_FILE_THRESHOLD_BYTES) {
            return EngineType::Aria2c;
        }
    }
    EngineType::YtDlp
}

fn is_archive_url(raw_url: &str) -> bool {
    let Ok(url) = Url::parse(raw_url) else { return false };
    let path = url.path().to_ascii_lowercase();
    [".zip", ".rar", ".7z", ".tar", ".gz", ".iso", ".exe", ".msi", ".dmg", ".torrent"]
        .iter()
        .any(|extension| path.ends_with(extension))
}

fn is_youtube_url(raw_url: &str) -> bool {
    let Ok(url) = Url::parse(raw_url) else { return false };
    let Some(host) = url.host_str().map(str::to_ascii_lowercase) else { return false };
    host == "youtu.be"
        || host == "youtube.com"
        || host.ends_with(".youtube.com")
        || host == "youtube-nocookie.com"
        || host.ends_with(".youtube-nocookie.com")
}

fn is_html_page(content_type: Option<&str>) -> bool {
    let Some(content_type) = content_type else { return false };
    let media_type = content_type.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    matches!(media_type.as_str(), "text/html" | "application/xhtml+xml" | "application/json" | "application/ld+json")
}

async fn probe_remote_metadata(raw_url: &str) -> Option<RemoteMetadata> {
    let client = Client::builder()
        .timeout(PROBE_TIMEOUT)
        .redirect(reqwest::redirect::Policy::limited(10))
        .user_agent("LEVEL-UP-NEXUS/0.1")
        .build()
        .ok()?;

    if let Ok(response) = client.head(raw_url).send().await {
        if response.status().is_success() {
            let metadata = metadata_from_response(&response, false);
            if metadata.size_bytes.is_some() || is_html_page(metadata.content_type.as_deref()) {
                return Some(metadata);
            }
        }
    }

    let response = client
        .get(raw_url)
        .header(RANGE, "bytes=0-0")
        .send()
        .await
        .ok()?;
    if !response.status().is_success() && response.status() != StatusCode::PARTIAL_CONTENT {
        return None;
    }
    Some(metadata_from_response(&response, true))
}

fn metadata_from_response(response: &reqwest::Response, allow_content_range: bool) -> RemoteMetadata {
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let size_bytes = response
        .headers()
        .get(CONTENT_RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(parse_content_range_total)
        .filter(|_| allow_content_range)
        .or_else(|| response.headers().get(CONTENT_LENGTH).and_then(|value| value.to_str().ok()).and_then(|value| value.parse().ok()));
    RemoteMetadata { size_bytes, content_type }
}

fn parse_content_range_total(value: &str) -> Option<u64> {
    value.rsplit_once('/')?.1.trim().parse().ok()
}

#[cfg(test)]
mod tests {
    use super::{choose_engine, parse_content_range_total, probe_remote_metadata, RemoteMetadata, LARGE_FILE_THRESHOLD_BYTES};
    use crate::models::EngineType;
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;
    use std::thread;

    fn block_on<F: std::future::Future>(future: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(future)
    }

    fn mock_http_server(responses: Vec<&'static str>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        thread::spawn(move || {
            for response in responses {
                let (mut stream, _) = listener.accept().unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 || line.trim().is_empty() {
                        break;
                    }
                }
                let _ = stream.write_all(response.as_bytes());
            }
        });
        format!("http://{address}/file.bin")
    }

    #[test]
    fn routes_youtube_to_ytdlp_without_size_probe() {
        assert!(matches!(choose_engine("https://www.youtube.com/watch?v=abc", None), EngineType::YtDlp));
        assert!(matches!(choose_engine("https://youtu.be/abc", None), EngineType::YtDlp));
    }

    #[test]
    fn routes_magnets_and_archives_to_aria2() {
        assert!(matches!(choose_engine("magnet:?xt=urn:btih:abc", None), EngineType::Aria2c));
        assert!(matches!(choose_engine("https://cdn.example.test/file.zip?download=1", None), EngineType::Aria2c));
    }

    #[test]
    fn routes_direct_downloads_at_or_above_100_mib_to_aria2() {
        let metadata = |size| RemoteMetadata { size_bytes: Some(size), content_type: Some("application/octet-stream".into()) };
        assert!(matches!(choose_engine("https://cdn.example.test/video.mp4", Some(&metadata(LARGE_FILE_THRESHOLD_BYTES))), EngineType::Aria2c));
        assert!(matches!(choose_engine("https://cdn.example.test/video.mp4", Some(&metadata(LARGE_FILE_THRESHOLD_BYTES - 1))), EngineType::YtDlp));
    }

    #[test]
    fn keeps_html_pages_on_ytdlp_even_when_the_page_is_large() {
        let metadata = RemoteMetadata { size_bytes: Some(LARGE_FILE_THRESHOLD_BYTES * 2), content_type: Some("text/html; charset=utf-8".into()) };
        assert!(matches!(choose_engine("https://media.example.test/watch/123", Some(&metadata)), EngineType::YtDlp));
    }

    #[test]
    fn parses_total_size_from_content_range() {
        assert_eq!(parse_content_range_total("bytes 0-0/104857600"), Some(LARGE_FILE_THRESHOLD_BYTES));
        assert_eq!(parse_content_range_total("bytes 0-0/*"), None);
        assert_eq!(parse_content_range_total("invalid"), None);
    }

    #[test]
    fn reads_file_size_from_head_response() {
        let url = mock_http_server(vec![
            "HTTP/1.1 200 OK\r\nContent-Length: 104857600\r\nContent-Type: application/octet-stream\r\nConnection: close\r\n\r\n",
        ]);
        let metadata = block_on(probe_remote_metadata(&url)).unwrap();
        assert_eq!(metadata.size_bytes, Some(LARGE_FILE_THRESHOLD_BYTES));
        assert_eq!(metadata.content_type.as_deref(), Some("application/octet-stream"));
    }

    #[test]
    fn falls_back_to_range_when_head_is_not_supported() {
        let url = mock_http_server(vec![
            "HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            "HTTP/1.1 206 Partial Content\r\nContent-Range: bytes 0-0/104857600\r\nContent-Length: 1\r\nContent-Type: application/octet-stream\r\nConnection: close\r\n\r\nx",
        ]);
        let metadata = block_on(probe_remote_metadata(&url)).unwrap();
        assert_eq!(metadata.size_bytes, Some(LARGE_FILE_THRESHOLD_BYTES));
        assert_eq!(metadata.content_type.as_deref(), Some("application/octet-stream"));
    }
}
