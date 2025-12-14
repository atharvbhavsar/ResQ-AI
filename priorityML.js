// Deep Learning Priority Classification Module

const { pipeline } = require('@huggingface/transformers');

let textClassifier = null;
let modelReady = false;

// Initialize the neural network models
async function initializePriorityModels() {
  try {
    console.log('[DL] 🧠 Initializing deep learning models...');
    
    // Load pre-trained text classification model from Hugging Face
    // Using BART-based zero-shot classification for emergency categorization
    // textClassifier = await pipeline('zero-shot-classification', 'facebook/bart-large-mnli');
    textClassifier = await pipeline('zero-shot-classification', 'Xenova/distilbert-base-uncased-mnli');
    console.log("Model ready");

    modelReady = true;
    console.log('[DL] ✅ Text classification model loaded successfully');
    console.log('[DL] ✅ Deep learning system ready for emergency classification');
    return true;
  } catch (error) {
    console.error('[DL] ❌ Failed to load models:', error.message);
    console.log('[DL] ⚠️  Falling back to rule-based priority assignment');
    modelReady = false;
    return false;
  }
}

// Deep Learning-Based Priority Assignment
async function assignPriorityML(emergencyText, voiceStressLevel = 0.5) {
  if (!emergencyText || emergencyText === 'undefined') {
    return { priority: 0, confidence: 0, method: 'fallback' };
  }

  try {
    if (!modelReady || !textClassifier) {
      return assignPriorityFallback(emergencyText);
    }

    // Define emergency categories for zero-shot classification
    const candidateLabels = [
      'fire emergency or building collapse or active shooter or cardiac arrest or drowning or severe trauma or sexual assault or rape', // L1
      'medical emergency or severe injury or assault or armed threat', // L2
      'minor injury or property crime or suspicious activity', // L3
      'non-urgent issue or minor complaint', // L4
      'information request or general inquiry' // L5
    ];

    // Classify the emergency text using transformer model
    const classification = await textClassifier(emergencyText, candidateLabels, {
      multi_class: false
    });

    // Map classifications to priority levels
    const labelToPriority = {
      'fire emergency or building collapse or active shooter or cardiac arrest or drowning or severe trauma or sexual assault or rape': 1,
      'medical emergency or severe injury or assault or armed threat': 2,
      'minor injury or property crime or suspicious activity': 3,
      'non-urgent issue or minor complaint': 4,
      'information request or general inquiry': 5
    };

    const topLabel = classification.labels[0];
    let basePriority = labelToPriority[topLabel] || 4;
    const confidence = classification.scores[0];

    // Critical keyword override - ensure life-threatening emergencies get L1 priority
    const criticalKeywords = ['fire', 'burning', 'flames', 'smoke', 'explosion', 'cardiac arrest', 'heart attack', 
                             'not breathing', 'unconscious', 'drowning', 'shooting', 'gunshot', 'stabbing', 
                             'active shooter', 'armed attack', 'stroke', 'severe burn', 'collapse',
                             'sexual assault', 'rape', 'sexual violence', 'sexual attack', 'molest', 'assault victim'];
    
    const emergencyLower = emergencyText.toLowerCase();
    const hasCriticalKeyword = criticalKeywords.some(keyword => emergencyLower.includes(keyword));
    
    if (hasCriticalKeyword && basePriority > 1) {
      console.log(`[DL] 🚨 Critical keyword detected - overriding to L1 priority`);
      basePriority = 1;
    }

    // Boost priority if voice stress is detected (emotion detection)
    if (voiceStressLevel > 0.7) {
      basePriority = Math.max(1, basePriority - 1); // Bump up by one level
      console.log(`[DL] 😰 High stress detected (${voiceStressLevel.toFixed(2)}). Boosting priority from ${basePriority + 1} to ${basePriority}`);
    }

    console.log(`[DL] 🧠 ML Classification: "${topLabel}" (${(confidence * 100).toFixed(1)}%) → Priority ${basePriority}${hasCriticalKeyword ? ' [CRITICAL OVERRIDE]' : ''}`);

    return {
      priority: basePriority,
      confidence: confidence,
      classificationLabel: topLabel,
      method: 'deep-learning',
      stressAdjustment: voiceStressLevel > 0.7,
      criticalOverride: hasCriticalKeyword
    };
  } catch (error) {
    console.error('[DL] ❌ ML classification failed:', error.message);
    return assignPriorityFallback(emergencyText);
  }
}

// Fallback: Rule-based priority (original function as backup)
function assignPriorityFallback(emergency) {
  if (!emergency || emergency === 'undefined') return { priority: 0, confidence: 0, method: 'fallback' };
  
  const em = emergency.toLowerCase();
  
  // L1 - CRITICAL
  const l1Keywords = ['rape', 'sexual assault', 'unconscious', 'cardiac arrest', 'not breathing', 'heart attack', 'stroke', 'severe burn', 'fire', 'active shooter', 'kidnap', 'drowning', 'collapse', 'shooting', 'gunshot', 'stabbing', 'armed', 'armed attack'];
  if (l1Keywords.some(word => em.includes(word))) {
    console.log(`[DL] 🔴 L1 (Fallback - keyword match): ${emergency}`);
    return { priority: 1, confidence: 0.9, method: 'fallback-l1' };
  }
  
  // L2 - URGENT
  const l2Keywords = ['fracture', 'broken', 'burglary', 'missing person', 'animal bite', 'allergy', 'asthma', 'fever', 'severe vomiting', 'dehydration'];
  if (l2Keywords.some(word => em.includes(word))) {
    console.log(`[DL] 🟠 L2 (Fallback - keyword match): ${emergency}`);
    return { priority: 2, confidence: 0.85, method: 'fallback-l2' };
  }
  
  // L3 - SEMI-URGENT
  const l3Keywords = ['vomiting', 'injury', 'assault', 'robbery', 'suspicious', 'minor accident'];
  if (l3Keywords.some(word => em.includes(word))) {
    console.log(`[DL] 🟡 L3 (Fallback - keyword match): ${emergency}`);
    return { priority: 3, confidence: 0.8, method: 'fallback-l3' };
  }
  
  // L4 - NON-URGENT (default)
  console.log(`[DL] 🔵 L4 (Fallback - default): ${emergency}`);
  return { priority: 4, confidence: 0.7, method: 'fallback-l4' };
}

// Detect emotional urgency from voice (placeholder - can integrate with audio analysis library)
async function detectVoiceStress(audioBuffer) {
  // TODO: Integrate with librosa or audio-processing library
  // For now, return a placeholder value
  // In production, use: voice pitch analysis, tremor detection, speech rate
  return 0.5; // Placeholder: range 0.0 (calm) to 1.0 (critical panic)
}

module.exports = {
  initializePriorityModels,
  assignPriorityML,
  detectVoiceStress,
  assignPriorityFallback,
  isModelReady: () => modelReady
};
