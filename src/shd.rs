use std::collections::HashMap;
use tokio::sync::RwLock;

pub struct Geometry {
    pub boundary: usize,
    pub model_id: String,
}

pub struct DiscoveryEngine {
    cache: RwLock<HashMap<String, Geometry>>,
}

impl DiscoveryEngine {
    pub fn new() -> Self {
        let mut initial = HashMap::new();
        initial.insert("gpt-4o".to_string(), Geometry { boundary: 128, model_id: "gpt-4o".into() });
        initial.insert("claude-3-5-sonnet".to_string(), Geometry { boundary: 1024, model_id: "claude-3-5-sonnet".into() });
        
        Self { cache: RwLock::new(initial) }
    }

    pub async fn get_geometry(&self, model: &str) -> Geometry {
        let read = self.cache.read().await;
        if let Some(g) = read.get(model) {
            return Geometry { boundary: g.boundary, model_id: g.model_id.clone() };
        }
        drop(read);

        // SELF-HEALING: If unknown, trigger discovery and return default
        self.trigger_discovery(model).await;
        
        Geometry { boundary: 128, model_id: model.to_string() }
    }

    async fn trigger_discovery(&self, model: &str) {
        println!("🔍 SHD: Initiating Discovery for unknown model: {}", model);
        // In production: Sends a sequence of 1-token probes to verify boundary
        // For now, we update the cache with a 'learned' default
        let mut write = self.cache.write().await;
        write.insert(model.to_string(), Geometry { boundary: 128, model_id: model.to_string() });
    }
}
