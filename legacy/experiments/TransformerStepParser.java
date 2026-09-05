package com.svatah.automator.parser;

import org.apache.logging.log4j.LogManager;

import java.util.*;
import java.util.regex.Pattern;

/**
 * Transformer-based step parser using CoreNLP and BERT for natural language understanding.
 * 
 * This parser combines:
 * 1. CoreNLP for entity extraction (NER, POS tagging)
 * 2. JavaBERT for action classification
 * 
 * Format Examples:
 * - "Click the button that says 'Login' at the top of the page"
 * - "Enter the password that I saved in my notes into the username field"
 * - "Make sure the welcome message is visible on the screen"
 */
public class TransformerStepParser {

    private static final org.apache.logging.log4j.Logger logger = LogManager.getLogger(TransformerStepParser.class);
    
    // CoreNLP entity extractor
    private final CoreNLPEntityExtractor entityExtractor;
    
    // BERT action classifier
    private final JavaBERTActionClassifier actionClassifier;

    /**
     * Create transformer parser with default settings.
     */
    public TransformerStepParser() {
        this.entityExtractor = new CoreNLPEntityExtractor();
        this.actionClassifier = new JavaBERTActionClassifier();
        logger.info("TransformerStepParser initialized with CoreNLP and JavaBERT");
    }

    /**
     * Parse a step line using transformer-based approach.
     */
    public StepInfo parse(String line) {
        StepInfo stepInfo = new StepInfo();
        
        if (line == null || line.trim().isEmpty()) {
            return stepInfo;
        }
        
        // Step 1: Extract action using BERT classifier
        stepInfo.actionName = actionClassifier.classify(line);
        
        // Step 2: Extract entities using CoreNLP
        Map<String, String> entities = entityExtractor.extractEntities(line);
        stepInfo.locators = entities;
        
        // Step 3: Extract data values
        stepInfo.data = extractData(line, entities);
        
        // Step 4: Extract output variable
        stepInfo.outputVariable = extractOutputVariable(line);
        
        return stepInfo;
    }

    /**
     * Extract data values from step line.
     */
    private List<String> extractData(String line, Map<String, String> locators) {
        List<String> data = new ArrayList<>();
        
        // Pattern: "Type [value] into [field]"
        Pattern typePattern = Pattern.compile("(?i)^\\s*(?:type|enter|input|fill|set|write)\\s+(\\S+)");
        java.util.regex.Matcher matcher = typePattern.matcher(line);
        if (matcher.find()) {
            String value = matcher.group(1);
            // Don't add if it's already a locator
            if (!locators.containsValue(value)) {
                data.add(value);
            }
        }
        
        // Pattern: "Click [button/text]"
        Pattern clickPattern = Pattern.compile("(?i)^\\s*click\\s+(?:the\\s+)?(?:button\\s+)?(?:that\\s+)?(?:says|labelled|with)\\s+[\"']([^\"']+)[\"']");
        matcher = clickPattern.matcher(line);
        if (matcher.find()) {
            data.add(matcher.group(1));
        }
        
        return data;
    }

    /**
     * Extract output variable from step line.
     */
    private String extractOutputVariable(String line) {
        // Pattern: "var:variableName" or "var(variableName)"
        Pattern varPattern = Pattern.compile("(?i)(var\\s*:\\s*(\\S+))|(var\\s*\\((\\S+)\\))");
        java.util.regex.Matcher matcher = varPattern.matcher(line);
        if (matcher.find()) {
            return matcher.group(2) != null ? matcher.group(2) : matcher.group(4);
        }
        return null;
    }

    /**
     * Internal class to hold parsed step information.
     */
    public static class StepInfo {
        String actionName;
        List<String> data;
        Map<String, String> locators;
        String outputVariable;
        
        StepInfo() {
            this.data = new ArrayList<>();
            this.locators = new LinkedHashMap<>();
        }
    }
}