package com.svatah.automator.parser;

import edu.stanford.nlp.ling.CoreLabel;
import edu.stanford.nlp.ling.CoreAnnotations;
import edu.stanford.nlp.pipeline.Annotation;
import edu.stanford.nlp.pipeline.StanfordCoreNLP;
import edu.stanford.nlp.util.CoreMap;
import org.apache.logging.log4j.LogManager;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Entity extractor using Stanford CoreNLP.
 * 
 * This class provides NLP capabilities for:
 * - Named Entity Recognition (NER)
 * - Part-of-Speech (POS) tagging
 * - Entity extraction from natural language
 * 
 * Usage:
 * CoreNLPEntityExtractor extractor = new CoreNLPEntityExtractor();
 * Map<String, String> entities = extractor.extractEntities("Click the login button");
 */
public class CoreNLPEntityExtractor {

    private static final org.apache.logging.log4j.Logger logger = LogManager.getLogger(CoreNLPEntityExtractor.class);
    
    // Common locator prefixes
    private static final List<String> LOCATOR_PREFIXES = Arrays.asList(
        "id", "name", "xpath", "css", "class", "tag", "link", "partialLink",
        "text", "value", "type", "index", "dom", "js", "accessibility", "image", "coord"
    );
    
    // Pattern for extracting locators like id:username, name:email
    private static final Pattern LOCATOR_PATTERN = Pattern.compile("(?i)\\b(id|name|xpath|css|class|tag|link|text|value):\\s*(\\S+)");
    
    // Stanford CoreNLP pipeline (lazy initialized, thread-safe)
    private static final class PipelineHolder {
        private static final StanfordCoreNLP PIPELINE = createPipeline();
        
        private static StanfordCoreNLP createPipeline() {
            Properties props = new Properties();
            props.setProperty("annotators", "tokenize,ssplit,pos,lemma,ner");
            props.setProperty("ner.model", "edu/stanford/nlp/models/ner/english.all.3class.distsim.crf.ser.gz");
            props.setProperty("corenlp.log4j", "false");
            return new StanfordCoreNLP(props);
        }
    }
    
    private static final Map<String, Pattern> PATTERN_CACHE = new ConcurrentHashMap<>();

    /**
     * Extract entities from text using CoreNLP.
     */
    public Map<String, String> extractEntities(String text) {
        Map<String, String> entities = new LinkedHashMap<>();
        
        if (text == null || text.trim().isEmpty()) {
            return entities;
        }
        
        // First, extract explicit locators (id:, name:, etc.)
        extractExplicitLocators(text, entities);
        
        // Then use CoreNLP for NER
        extractNEREntities(text, entities);
        
        // Extract contextual entities
        extractContextualEntities(text, entities);
        
        return entities;
    }

    /**
     * Extract explicit locators like id:username, name:email
     */
    private void extractExplicitLocators(String text, Map<String, String> entities) {
        Matcher matcher = LOCATOR_PATTERN.matcher(text);
        while (matcher.find()) {
            String type = matcher.group(1).toLowerCase();
            String value = matcher.group(2);
            
            // Normalize locator type
            String normalizedType = normalizeLocatorType(type);
            if (!entities.containsKey(normalizedType)) {
                entities.put(normalizedType, value);
            }
        }
    }

    /**
     * Extract entities using CoreNLP NER.
     */
    private void extractNEREntities(String text, Map<String, String> entities) {
        try {
            Annotation annotation = new Annotation(text);
            PipelineHolder.PIPELINE.annotate(annotation);
            
            // Extract NER entities
            List<CoreMap> sentences = annotation.get(CoreAnnotations.SentencesAnnotation.class);
            for (CoreMap sentence : sentences) {
                for (CoreLabel token : sentence.get(CoreAnnotations.TokensAnnotation.class)) {
                    String word = token.word();
                    String nerTag = token.get(CoreAnnotations.NamedEntityTagAnnotation.class);
                    
                    // Map NER tags to locator types
                    if ("PERSON".equals(nerTag)) {
                        // Could be a username or person name
                        if (!entities.containsKey("name")) {
                            entities.put("name", word);
                        }
                    } else if ("LOCATION".equals(nerTag)) {
                        // Could be a page or location
                        if (!entities.containsKey("location")) {
                            entities.put("location", word);
                        }
                    } else if ("ORGANIZATION".equals(nerTag)) {
                        // Could be a company or organization name
                        if (!entities.containsKey("text")) {
                            entities.put("text", word);
                        }
                    }
                }
            }
        } catch (Exception e) {
            logger.warn("Error extracting NER entities: " + e.getMessage());
        }
    }

    /**
     * Extract contextual entities from natural language patterns.
     */
    private void extractContextualEntities(String text, Map<String, String> entities) {
        // Pattern: "into [field/element/input] [name]"
        Pattern intoPattern = getPattern("(?i)into\\s+(?:the\\s+)?(?:field|element|input|box)\\s+(\\S+)");
        Matcher matcher = intoPattern.matcher(text);
        if (matcher.find() && !entities.containsKey("name")) {
            entities.put("name", matcher.group(1));
        }
        
        // Pattern: "button [that] [says/labelled] '[text]'"
        Pattern buttonPattern = getPattern("(?i)button\\s+(?:that\\s+)?(?:says|labelled|with)\\s+[\"']([^\"']+)[\"']");
        matcher = buttonPattern.matcher(text);
        if (matcher.find() && !entities.containsKey("text")) {
            entities.put("text", matcher.group(1));
        }
        
        // Pattern: "at [the] [top/bottom/left/right] [of] [the] [page]"
        Pattern locationPattern = getPattern("(?i)at\\s+(?:the\\s+)?(top|bottom|left|right)\\s+(?:of\\s+)?(?:the\\s+)?(page|screen)");
        matcher = locationPattern.matcher(text);
        if (matcher.find()) {
            String location = matcher.group(1);
            if (!entities.containsKey("location")) {
                entities.put("location", location);
            }
        }
        
        // Pattern: "with [text]"
        Pattern withPattern = getPattern("(?i)\\bwith\\s+[\"']([^\"']+)[\"']");
        matcher = withPattern.matcher(text);
        if (matcher.find() && !entities.containsKey("text")) {
            entities.put("text", matcher.group(1));
        }
    }

    /**
     * Normalize locator type to standard format.
     */
    private String normalizeLocatorType(String type) {
        Map<String, String> synonyms = new HashMap<>();
        synonyms.put("identifier", "id");
        synonyms.put("element id", "id");
        synonyms.put("css selector", "css");
        synonyms.put("class name", "className");
        synonyms.put("tag name", "tagName");
        synonyms.put("link text", "linkText");
        synonyms.put("partial link text", "partialLinkText");
        
        return synonyms.getOrDefault(type.toLowerCase(), type);
    }

    /**
     * Get or cache regex pattern.
     */
    private Pattern getPattern(String patternString) {
        return PATTERN_CACHE.computeIfAbsent(patternString, Pattern::compile);
    }

    /**
     * Get the CoreNLP pipeline instance (for advanced usage).
     */
    public StanfordCoreNLP getPipeline() {
        return PipelineHolder.PIPELINE;
    }
}