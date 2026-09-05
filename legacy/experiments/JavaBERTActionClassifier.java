package com.svatah.automator.parser;

import org.apache.logging.log4j.LogManager;

import java.util.*;

/**
 * Action classifier using synonym matching and optional BERT integration.
 * 
 * This class provides action classification for natural language steps.
 * It maps natural language actions to canonical action names used in the automation framework.
 * 
 * Current implementation uses synonym matching (fast, no ML dependencies).
 * BERT integration is available as an optional enhancement.
 * 
 * Usage:
 * JavaBERTActionClassifier classifier = new JavaBERTActionClassifier();
 * String action = classifier.classify("Click the submit button");
 * 
 * For BERT integration, add the following dependencies to build.gradle:
 * implementation 'ai.djl:api:0.28.0'
 * implementation 'ai.djl.huggingface:tokenizers:0.28.0'
 * implementation 'ai.djl.pytorch:pytorch-engine:0.28.0'
 */
public class JavaBERTActionClassifier {

    private static final org.apache.logging.log4j.Logger logger = LogManager.getLogger(JavaBERTActionClassifier.class);
    
    // Canonical action names
    private static final List<String> ACTION_CLASSES = Arrays.asList(
        "click", "type", "verify", "navigate", "wait", "scroll", "hover",
        "drag", "drop", "upload", "download", "close", "accept", "refresh",
        "navigateBack", "navigateForward", "alert", "switchWindow", "switchTab"
    );
    
    // Action synonyms mapping to canonical names
    private static final Map<String, String> ACTION_SYNONYMS = new HashMap<>();
    
    static {
        // Click synonyms
        ACTION_SYNONYMS.put("press", "click");
        ACTION_SYNONYMS.put("tap", "click");
        ACTION_SYNONYMS.put("select", "click");
        ACTION_SYNONYMS.put("choose", "click");
        ACTION_SYNONYMS.put("click", "click");
        
        // Type synonyms
        ACTION_SYNONYMS.put("enter", "type");
        ACTION_SYNONYMS.put("input", "type");
        ACTION_SYNONYMS.put("fill", "type");
        ACTION_SYNONYMS.put("set", "type");
        ACTION_SYNONYMS.put("write", "type");
        ACTION_SYNONYMS.put("send", "type");
        ACTION_SYNONYMS.put("type", "type");
        
        // Verify synonyms
        ACTION_SYNONYMS.put("assert", "verify");
        ACTION_SYNONYMS.put("check", "verify");
        ACTION_SYNONYMS.put("confirm", "verify");
        ACTION_SYNONYMS.put("ensure", "verify");
        ACTION_SYNONYMS.put("validate", "verify");
        ACTION_SYNONYMS.put("see", "verify");
        ACTION_SYNONYMS.put("find", "verify");
        ACTION_SYNONYMS.put("locate", "verify");
        ACTION_SYNONYMS.put("verify", "verify");
        
        // Navigate synonyms
        ACTION_SYNONYMS.put("go", "navigate");
        ACTION_SYNONYMS.put("open", "navigate");
        ACTION_SYNONYMS.put("visit", "navigate");
        ACTION_SYNONYMS.put("load", "navigate");
        ACTION_SYNONYMS.put("navigate", "navigate");
        
        // Wait synonyms
        ACTION_SYNONYMS.put("pause", "wait");
        ACTION_SYNONYMS.put("sleep", "wait");
        ACTION_SYNONYMS.put("wait", "wait");
        
        // Scroll synonyms
        ACTION_SYNONYMS.put("swipe", "scroll");
        ACTION_SYNONYMS.put("scroll", "scroll");
        
        // Hover synonyms
        ACTION_SYNONYMS.put("mouse over", "hover");
        ACTION_SYNONYMS.put("hover", "hover");
        
        // Close synonyms
        ACTION_SYNONYMS.put("dismiss", "close");
        ACTION_SYNONYMS.put("cancel", "close");
        ACTION_SYNONYMS.put("close", "close");
        
        // Accept synonyms
        ACTION_SYNONYMS.put("allow", "accept");
        ACTION_SYNONYMS.put("accept", "accept");
        
        // Refresh synonyms
        ACTION_SYNONYMS.put("reload", "refresh");
        ACTION_SYNONYMS.put("refresh", "refresh");
        
        // Back/Forward
        ACTION_SYNONYMS.put("back", "navigateBack");
        ACTION_SYNONYMS.put("forward", "navigateForward");
    }
    
    // Pattern for extracting output variables
    private static final java.util.regex.Pattern OUTPUT_VAR_PATTERN = 
        java.util.regex.Pattern.compile("(var\\s*:\\s*(\\S+))|(var\\s*\\((\\S+)\\))");
    
    // Pattern for extracting locators
    private static final java.util.regex.Pattern LOCATOR_PATTERN = 
        java.util.regex.Pattern.compile("(?i)\\b(id|name|xpath|css|class|tag|link|text|value):\\s*(\\S+)");

    /**
     * Create classifier with default settings.
     */
    public JavaBERTActionClassifier() {
        logger.info("JavaBERTActionClassifier initialized");
    }

    /**
     * Classify action from natural language text.
     */
    public String classify(String text) {
        if (text == null || text.trim().isEmpty()) {
            return null;
        }
        
        // First try synonym matching (fast, no BERT needed)
        String synonymAction = matchSynonyms(text);
        if (synonymAction != null) {
            return synonymAction;
        }
        
        // Fallback to keyword matching
        return matchKeywords(text);
    }

    /**
     * Match action using synonym dictionary (fast path).
     */
    private String matchSynonyms(String text) {
        String lowerText = text.toLowerCase();
        
        // Remove output variable
        lowerText = removeOutputVariable(lowerText);
        
        // Remove locators
        lowerText = removeLocators(lowerText);
        
        String[] tokens = lowerText.split("\\s+");
        
        // Try each token as potential action
        for (String token : tokens) {
            String cleanToken = token.replaceAll("[^a-z]", "");
            if (ACTION_SYNONYMS.containsKey(cleanToken)) {
                return ACTION_SYNONYMS.get(cleanToken);
            }
        }
        
        // Try two-word combinations
        for (int i = 0; i < tokens.length - 1; i++) {
            String twoWords = tokens[i] + " " + tokens[i + 1];
            if (ACTION_SYNONYMS.containsKey(twoWords)) {
                return ACTION_SYNONYMS.get(twoWords);
            }
        }
        
        return null;
    }

    /**
     * Match action using keyword matching (fallback).
     */
    private String matchKeywords(String text) {
        String lowerText = text.toLowerCase();
        
        // Check for action keywords in text
        for (String action : ACTION_CLASSES) {
            if (lowerText.contains(action)) {
                return action;
            }
        }
        
        return null;
    }

    /**
     * Remove output variable from text.
     */
    private String removeOutputVariable(String text) {
        return text.replaceAll("(var\\s*:\\s*\\S+)|(var\\s*\\(\\S+\\))", "").trim();
    }

    /**
     * Remove locators from text.
     */
    private String removeLocators(String text) {
        return text.replaceAll("(?i)\\b(id|name|xpath|css|class|tag|link|text|value):\\s*\\S+", "");
    }

    /**
     * Get all supported action classes.
     */
    public List<String> getActionClasses() {
        return ACTION_CLASSES;
    }

    /**
     * Get action synonyms map.
     */
    public Map<String, String> getActionSynonyms() {
        return ACTION_SYNONYMS;
    }
}