use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;

const GET_TIMEOUT: Duration = Duration::from_secs(6);
const POST_TIMEOUT: Duration = Duration::from_secs(30);

fn normalize_base(base_url: &str) -> String {
    let b = base_url.trim().trim_end_matches('/');
    if b.is_empty() {
        "http://localhost:41595".to_string()
    } else {
        b.to_string()
    }
}

fn request(method: &str, base_url: &str, api: &str, token: &str) -> ureq::Request {
    let url = format!("{}/api/{}", normalize_base(base_url), api);
    let req = ureq::request(method, &url);
    if token.trim().is_empty() {
        req
    } else {
        req.query("token", token.trim())
    }
}

fn map_ureq_err(e: ureq::Error) -> String {
    match e {
        ureq::Error::Status(code, _) => format!("Eagle 返回 HTTP {code}"),
        // Transport 的 Display 含完整 URL（包括 token）；仅传出不带请求数据的错误分类。
        ureq::Error::Transport(t) => {
            format!("无法连接 Eagle（请确认 Eagle 已启动）: {}", t.kind())
        }
    }
}

fn redact_token(message: &str, token: &str) -> String {
    let token = token.trim();
    if token.is_empty() {
        return message.to_string();
    }
    let encoded: String = token
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect();
    message
        .replace(token, "[已隐藏]")
        .replace(&encoded, "[已隐藏]")
}

fn ensure_success(v: &Value, token: &str) -> Result<(), String> {
    if v.get("status").and_then(|s| s.as_str()) == Some("success") {
        Ok(())
    } else {
        Err(redact_token(
            v.get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("Eagle 返回错误"),
            token,
        ))
    }
}

fn api_get(base_url: &str, token: &str, api: &str) -> Result<Value, String> {
    let resp = request("GET", base_url, api, token)
        .timeout(GET_TIMEOUT)
        .call()
        .map_err(map_ureq_err)?;
    resp.into_json::<Value>()
        .map_err(|e| format!("解析 Eagle 响应失败: {e}"))
}

fn api_post(base_url: &str, token: &str, api: &str, body: Value) -> Result<Value, String> {
    let resp = request("POST", base_url, api, token)
        .timeout(POST_TIMEOUT)
        .send_json(body)
        .map_err(map_ureq_err)?;
    resp.into_json::<Value>()
        .map_err(|e| format!("解析 Eagle 响应失败: {e}"))
}

/// 连接测试，返回 Eagle 版本号
pub fn ping(base_url: &str, token: &str) -> Result<String, String> {
    let v = api_get(base_url, token, "application/info")?;
    ensure_success(&v, token)?;
    Ok(v.get("data")
        .and_then(|d| d.get("version"))
        .and_then(|s| s.as_str())
        .unwrap_or("?")
        .to_string())
}

/// 文件夹树（原样返回 data 数组，前端负责展平）
pub fn folders(base_url: &str, token: &str) -> Result<Value, String> {
    let v = api_get(base_url, token, "folder/list")?;
    ensure_success(&v, token)?;
    Ok(v.get("data").cloned().unwrap_or_else(|| json!([])))
}

#[derive(Debug, Clone, Deserialize)]
pub struct PathImportItem {
    pub path: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub annotation: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ImportFailure {
    pub path: String,
    pub name: String,
    pub error: String,
}

#[derive(Debug, Serialize)]
pub struct ImportOutcome {
    pub total: usize,
    pub succeeded: usize,
    pub failed: Vec<ImportFailure>,
}

fn insert_common(
    body: &mut Map<String, Value>,
    tags: &[String],
    annotation: &Option<String>,
    folder_id: &Option<String>,
) {
    let tags: Vec<&String> = tags.iter().filter(|t| !t.trim().is_empty()).collect();
    if !tags.is_empty() {
        body.insert("tags".into(), json!(tags));
    }
    if let Some(a) = annotation {
        if !a.trim().is_empty() {
            body.insert("annotation".into(), json!(a));
        }
    }
    if let Some(f) = folder_id {
        if !f.trim().is_empty() {
            body.insert("folderId".into(), json!(f));
        }
    }
}

/// 批量导入磁盘上已有的文件（Eagle 自行复制进资源库，原文件不动）
pub fn import_paths(
    base_url: &str,
    token: &str,
    items: &[PathImportItem],
    folder_id: &Option<String>,
) -> ImportOutcome {
    let mut failed = Vec::new();
    for item in items {
        let mut body = Map::new();
        body.insert("path".into(), json!(item.path));
        if let Some(n) = &item.name {
            if !n.trim().is_empty() {
                body.insert("name".into(), json!(n));
            }
        }
        insert_common(&mut body, &item.tags, &item.annotation, folder_id);

        let result = api_post(base_url, token, "item/addFromPath", Value::Object(body))
            .and_then(|v| ensure_success(&v, token));
        if let Err(e) = result {
            failed.push(ImportFailure {
                path: item.path.clone(),
                name: item.name.clone().unwrap_or_else(|| item.path.clone()),
                error: e,
            });
        }
    }
    ImportOutcome {
        total: items.len(),
        succeeded: items.len() - failed.len(),
        failed,
    }
}

/// 把内存中的 JPEG 直接推给 Eagle（base64 data URL，不经过磁盘）
pub fn import_jpeg_bytes(
    base_url: &str,
    token: &str,
    jpeg: &[u8],
    name: &str,
    tags: &[String],
    annotation: &Option<String>,
    folder_id: &Option<String>,
) -> Result<(), String> {
    let mut body = Map::new();
    body.insert(
        "url".into(),
        json!(format!("data:image/jpeg;base64,{}", B64.encode(jpeg))),
    );
    if !name.trim().is_empty() {
        body.insert("name".into(), json!(name));
    }
    insert_common(&mut body, tags, annotation, folder_id);

    let v = api_post(base_url, token, "item/addFromURL", Value::Object(body))?;
    ensure_success(&v, token)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tokens_are_encoded_and_never_appear_in_transport_errors() {
        let token = "synthetic#a&b+c/only";
        let req = request("GET", "http://127.0.0.1:1", "application/info", token);
        assert!(req.url().contains("token=synthetic%23a%26b%2Bc%2Fonly"));
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let error = ping(&format!("http://127.0.0.1:{port}"), token).unwrap_err();
        assert!(!error.contains(token));
        assert!(!error.contains("token="));
        let error = ensure_success(
            &json!({"status":"error","message":format!("invalid {token}")}),
            token,
        )
        .unwrap_err();
        assert!(!error.contains(token));
        assert!(error.contains("[已隐藏]"));
    }
}
