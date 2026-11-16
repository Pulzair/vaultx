//! Outbound HTTP lives in Rust so the web UI is not blocked by CORS.
//! Used for ICS calendar subscriptions and RSS news feeds.

use crate::StrErr;

#[tauri::command]
pub async fn fetch_text(url: String) -> Result<String, String> {
    // Calendar apps hand out webcal:// links; they are plain HTTPS.
    let url = if let Some(rest) = url.strip_prefix("webcal://") {
        format!("https://{rest}")
    } else {
        url
    };
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Only http(s) and webcal links are supported".into());
    }
    let client = reqwest::Client::builder()
        .user_agent("VaultX/0.0.1")
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .str_err()?;
    let resp = client.get(&url).send().await.str_err()?;
    if !resp.status().is_success() {
        return Err(format!("{} returned {}", url, resp.status()));
    }
    resp.text().await.str_err()
}
