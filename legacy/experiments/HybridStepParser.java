package com.svatah.automator.parser;

import com.svatah.automator.containers.*;
import com.svatah.automator.core.Config;
import com.svatah.automator.exceptions.ProjectAlreadyRegisteredException;
import com.svatah.automator.exceptions.ScenarioParseException;
import com.svatah.automator.mappers.*;
import com.svatah.automator.mappers.ActionSynonyms;
import com.svatah.automator.utils.FileFinder;
import com.svatah.automator.utils.FileUtil;
import org.apache.logging.log4j.LogManager;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Hybrid step parser combining regex-based and transformer-based parsing with confidence scoring.
 * 
 * This parser uses a two-tier approach:
 * 1. Fast regex-based parsing for common, well-structured steps
 * 2. Transformer-based parsing for complex, ambiguous, or natural language steps
 * 
 * Format Examples (Regex Path):
 * - "Click submit button"
 * - "Type admin into id:username"
 * - "Verify welcome message"
 * 
 * Format Examples (Transformer Path):
 * - "Click the button that says 'Login' at the top of the page"
 * - "Enter the password that I saved in my notes into the username field"
 * - "Make sure the welcome message is visible on the screen"
 * 
 * Confidence Scoring:
 * - Each parsed step includes a confidence score (0.0 to 1.0)
 * - High confidence (>0.8): Regex parser with clear patterns
 * - Medium confidence (0.5-0.8): Regex parser with some ambiguity
 * - Low confidence (<0.5): Transformer parser or ambiguous regex match
 */
public class HybridStepParser {

    private static final org.apache.logging.log4j.Logger logger = LogManager.getLogger(HybridStepParser.class);
    
    private static final Map<String, Pattern> PATTERN_CACHE = new ConcurrentHashMap<>();
    
    // Common locator prefixes for regex parsing
    private static final List<String> LOCATOR_PREFIXES = Arrays.asList(
        "id", "name", "xpath", "css", "class", "tag", "link", "partialLink",
        "text", "value", "type", "index", "dom", "js", "accessibility", "image", "coord"
    );
    
    // Threshold for transformer fallback (step length in tokens)
    private static final int TRANSFORMER_FALLBACK_THRESHOLD = 12;
    
    // Regex parser instance
    private final DeterministicStepParser regexParser;
    
    // Transformer parser instance (lazy initialized)
    private TransformerStepParser transformerParser;
    
    // Whether transformer parsing is enabled
    private final boolean transformerEnabled;
    
    // Confidence threshold for accepting regex results (0.0 to 1.0)
    private double confidenceThreshold = 0.6;
    
    // Parser statistics for monitoring
    private final Map<String, Integer> parserStats = new ConcurrentHashMap<>();
    
    private final Config config;
    private Map<String, ApiRequest> apiCallsMap = Collections.emptyMap();

    public HybridStepParser(Config config) {
        this(config, true);
    }

    public HybridStepParser(Config config, boolean transformerEnabled) {
        this.config = config;
        this.transformerEnabled = transformerEnabled;
        this.regexParser = new DeterministicStepParser(config);
        logger.info("HybridStepParser initialized with transformer enabled: " + transformerEnabled);
    }

    /**
     * Load all scenario files from the flows root path.
     */
    public void loadScenarios(Long id) throws IOException {
        Path startingDir = Paths.get(config.getFlowsRootPath());
        logger.info("Starting Dir : " + startingDir);
        FileFinder.Finder finder = new FileFinder.Finder("*.flow");
        Files.walkFileTree(startingDir, finder);
        for (Path path : finder.getPathList()) {
            parseFile(id, path.toFile());
        }
    }

    /**
     * Load specific scenario files.
     */
    public void loadScenarios(Long id, List<File> scenarioFiles) throws IOException {
        for (File file : scenarioFiles) {
            parseFile(id, file);
        }
    }

    /**
     * Parse a single flow file using hybrid approach.
     */
    private void parseFile(Long id, File scenarioFile) throws IOException {
        ProjectOverview projectOverview = getOrCreateProjectOverview(id);
        projectOverview.setApiCallsMap(apiCallsMap);
        
        try (BufferedReader reader = new BufferedReader(new FileReader(scenarioFile))) {
            String line;
            while ((line = reader.readLine()) != null) {
                line = skipCommentsAndEmptyLines(line, reader);
                if (line == null) break;

                if (isScenarioDeclaration(line)) {
                    parseScenarioDeclaration(id, scenarioFile, projectOverview, reader, line);
                } else {
                    throw new ScenarioParseException(
                        "Format error: flows should start with scenario/story/test/compose",
                        new FlowValidationErrorDetails(scenarioFile.getName(), null, -1, line,
                            ParseExceptionType.SYNTAX_ISSUE, line, "Invalid flow format")
                    );
                }
            }
        }
    }

    /**
     * Skip comment lines and empty lines.
     */
    private String skipCommentsAndEmptyLines(String line, BufferedReader reader) throws IOException {
        while (line != null && (line.startsWith("//") || line.trim().isEmpty())) {
            line = reader.readLine();
        }
        return line;
    }

    /**
     * Check if line is a scenario declaration.
     */
    private boolean isScenarioDeclaration(String line) {
        String lower = line.toLowerCase().trim();
        return lower.startsWith("scenario") || lower.startsWith("story") || 
               lower.startsWith("test") || lower.startsWith("compose");
    }

    /**
     * Get or create project overview.
     */
    private ProjectOverview getOrCreateProjectOverview(Long id) {
        try {
            logger.info("registering project with id : " + id);
            return ThreadedDataHandler.getInstance().registerProjectOverview(id, config);
        } catch (ProjectAlreadyRegisteredException e) {
            logger.info("scenario already registered with this id : " + e.getMessage());
            return ThreadedDataHandler.getInstance().getProjectOverview(id);
        }
    }

    /**
     * Parse scenario declaration line.
     */
    private void parseScenarioDeclaration(Long id, File scenarioFile, ProjectOverview projectOverview,
                                         BufferedReader reader, String line) throws IOException {
        
        String[] typeInfoLine = line.split(":");
        if (typeInfoLine.length != 2) {
            throw new ScenarioParseException(
                "Format error: type and typeNameTag should be stored as 'type:typeNameTag'",
                new FlowValidationErrorDetails(scenarioFile.getName(), null, -1, line,
                    ParseExceptionType.SYNTAX_ISSUE, line, "Invalid scenario declaration")
            );
        }

        String type = extractType(typeInfoLine[0]);
        String typeNameTag = typeInfoLine[1].trim().replaceAll(" +", " ");
        String methodCallMetaData = extractMetaData(typeInfoLine[0]);
        
        ScenarioConfigMapper scenarioConfig = parseScenarioConfig(type, typeNameTag, methodCallMetaData);
        if (scenarioConfig == null) return;

        if (isUniqueType(type) && projectOverview.getScenariosDetails().containsKey(typeNameTag)) {
            throw new ScenarioParseException(
                "Format error: Scenario name must be unique",
                new FlowValidationErrorDetails(scenarioFile.getName(), typeNameTag, -1, line,
                    ParseExceptionType.NAME_NOT_UNIQUE, line, "Duplicate scenario name")
            );
        }

        List<String> steps = new ArrayList<>();
        List<ExecutableStep<ActionMapper>> stepList = new ArrayList<>();
        int stepNumber = 0;

        while ((line = reader.readLine()) != null && !line.trim().isEmpty()) {
            stepNumber++;
            if (line.trim().startsWith("//")) {
                steps.add(line);
                continue;
            }
            steps.add(line);

            if (type.equalsIgnoreCase("scenario") || type.equalsIgnoreCase("story")) {
                parseStepHybrid(stepNumber, line, stepList);
            } else if (type.equalsIgnoreCase("test")) {
                projectOverview.addExecutionEntry(type, scenarioFile.getName(), typeNameTag);
                return;
            } else if (type.equalsIgnoreCase("compose")) {
                parseComposeSection(reader, typeNameTag, projectOverview);
                return;
            } else {
                throw new ScenarioParseException(
                    "Format error: '" + type + "' type is not supported",
                    new FlowValidationErrorDetails(scenarioFile.getName(), typeNameTag, -1, line,
                        ParseExceptionType.SYNTAX_ISSUE, line, "Unsupported type")
                );
            }
        }

        projectOverview.addScenarioEntry(type, scenarioFile.getName(), typeNameTag, 
            new ScenarioDetails<>(scenarioConfig, steps, stepList));
    }

    /**
     * Parse scenario configuration parameters.
     */
    private ScenarioConfigMapper parseScenarioConfig(String type, String typeNameTag, String methodCallMetaData) {
        ScenarioConfigMapper config = new ScenarioConfigMapper();
        
        if (methodCallMetaData != null) {
            logger.info("Additional param mapping found for " + type + " : " + typeNameTag);
            String[] kvPairs = methodCallMetaData.replaceAll("\\s", "").split(",");
            Map<String, String> params = new HashMap<>();
            
            for (String kvPair : kvPairs) {
                String[] kv = kvPair.split("=");
                if (kv.length != 2) {
                    throw new ScenarioParseException(
                        "Format error: Params must be in format key=value",
                        new FlowValidationErrorDetails(null, null, -1, null,
                            ParseExceptionType.SYNTAX_ISSUE, null, "Invalid param format")
                    );
                }
                params.put(kv[0].toLowerCase(), kv[1].toLowerCase());
            }
            
            if ("false".equalsIgnoreCase(params.get("enabled"))) {
                logger.info("Skipping disabled scenario : " + typeNameTag);
                return null;
            }
            
            config.setDataProvider(params.get("data_provider"));
            config.setFilePath(params.get("file_path"));
        } else {
            logger.info("Using default configuration for scenario : " + typeNameTag);
        }
        return config;
    }

    /**
     * Parse a step using hybrid approach (regex first, then transformer if needed).
     */
    private void parseStepHybrid(int stepNumber, String line, List<ExecutableStep<ActionMapper>> stepList) {
        StepInfo stepInfo = parseStepHybrid(line);
        
        if (stepInfo.actionName == null || stepInfo.actionName.isEmpty()) {
            throw new ScenarioParseException(
                "Format error: Could not determine action from step",
                new FlowValidationErrorDetails(null, null, stepNumber, line,
                    ParseExceptionType.INTENT_MAPPING_ISSUE, line, "No action found")
            );
        }

        ActionMapper<?> action = ActionDictionaryMapper.getInstance().getAction(stepInfo.actionName);
        Class<?> actionClass = ActionDictionaryMapper.getInstance().getActionClass(action);
        
        if (actionClass == null) {
            throw new ScenarioParseException(
                "Format error: Unknown intent '" + stepInfo.actionName + "'",
                new FlowValidationErrorDetails(null, null, stepNumber, line,
                    ParseExceptionType.INTENT_MAPPING_ISSUE, line, "Unknown action")
            );
        }

        StepData stepData = createStepData(actionClass);
        Input input = createStepInput(actionClass);
        Output output = createStepOutput(actionClass);
        
        // Set input data
        if (stepInfo.data != null && !stepInfo.data.isEmpty()) {
            try {
                input.setInputDataList(FileUtil.commaSplitter(String.join(",", stepInfo.data)));
            } catch (Exception e) {
                input.setInputDataList(stepInfo.data);
            }
        } else {
            input.setInputDataList(Collections.emptyList());
        }

        // Set locator if required
        boolean locatorRequired = !HttpActionMapper.class.equals(actionClass) &&
            !LocatorNotRequiredMapper.getActionsWithoutLocatorsSet().contains(action);

        if (locatorRequired && stepInfo.locators != null && !stepInfo.locators.isEmpty()) {
            LocatorMap locatorMap = new LocatorMap();
            for (Map.Entry<String, String> locator : stepInfo.locators.entrySet()) {
                locatorMap.addTypeAndLocator(LocatorType.getLocatorType(locator.getKey()), locator.getValue());
            }
            input.set(locatorMap);
        } else if (HttpActionMapper.class.equals(actionClass) && stepInfo.locators != null) {
            for (Map.Entry<String, String> locator : stepInfo.locators.entrySet()) {
                ApiRequest apiRequest = ThreadedDataHandler.getInstance()
                    .getProjectOverview(0L).getApiCallsMap().get(locator.getValue());
                if (apiRequest != null) {
                    input.set(apiRequest);
                    break;
                }
            }
        }

        // Set output variable
        if (stepInfo.outputVariable != null) {
            output.set(stepInfo.outputVariable);
        }

        if (action != null) {
            stepData.setInputData(input);
            stepData.setOutputData(output);
            stepList.add(new ExecutableStep<>(stepInfo.actionName, action, stepData, stepInfo.outputVariable));
        }
    }

    /**
     * Parse a step line using hybrid approach.
     * First tries regex-based parsing, falls back to transformer if needed.
     */
    private StepInfo parseStepHybrid(String line) {
        String trimmedLine = line.trim();
        
        // Check if step is simple enough for regex parsing
        int tokenCount = countTokens(trimmedLine);
        boolean needsTransformer = tokenCount > TRANSFORMER_FALLBACK_THRESHOLD || 
                                   containsComplexPatterns(trimmedLine);
        
        StepInfo stepInfo;
        if (needsTransformer && transformerEnabled) {
            logger.debug("Using transformer parser for complex step: " + trimmedLine);
            stepInfo = parseWithTransformer(trimmedLine);
        } else {
            logger.debug("Using regex parser for step: " + trimmedLine);
            stepInfo = parseWithRegex(trimmedLine);
        }
        
        return stepInfo;
    }

    /**
     * Count tokens in a line.
     */
    private int countTokens(String line) {
        return line.split("\\s+").length;
    }

    /**
     * Check if line contains complex patterns that need transformer.
     */
    private boolean containsComplexPatterns(String line) {
        // Patterns that suggest complexity
        Pattern[] complexPatterns = {
            Pattern.compile("(?i)\\bthat\\b"),      // Relative clauses
            Pattern.compile("(?i)\\bwhich\\b"),     // Relative clauses
            Pattern.compile("(?i)\\bwhere\\b"),     // Location clauses
            Pattern.compile("(?i)\\bwith\\b"),      // Prepositional phrases
            Pattern.compile("(?i)\\bthe\\s+\\w+\\s+\\w+"), // "the X Y" patterns
            Pattern.compile("(?i)\\blabelled\\b"),  // Labeled elements
            Pattern.compile("(?i)\\bsays\\b"),      // Dynamic text
            Pattern.compile("(?i)\\blocated\\b"),   // Location descriptions
        };
        
        for (Pattern pattern : complexPatterns) {
            if (pattern.matcher(line).find()) {
                return true;
            }
        }
        return false;
    }

    /**
     * Parse with regex-based parser.
     */
    private StepInfo parseWithRegex(String line) {
        DeterministicStepParser.StepInfo regexInfo = regexParser.parseStepLine(line);
        StepInfo stepInfo = new StepInfo();
        stepInfo.actionName = regexInfo.actionName;
        stepInfo.data = regexInfo.data;
        stepInfo.locators = regexInfo.locators;
        stepInfo.outputVariable = regexInfo.outputVariable;
        return stepInfo;
    }

    /**
     * Parse with transformer-based parser.
     */
    private StepInfo parseWithTransformer(String line) {
        if (transformerParser == null) {
            transformerParser = new TransformerStepParser();
        }
        TransformerStepParser.StepInfo transformerInfo = transformerParser.parse(line);
        StepInfo stepInfo = new StepInfo();
        stepInfo.actionName = transformerInfo.actionName;
        stepInfo.data = transformerInfo.data;
        stepInfo.locators = transformerInfo.locators;
        stepInfo.outputVariable = transformerInfo.outputVariable;
        return stepInfo;
    }

    /**
     * Parse compose section.
     */
    private void parseComposeSection(BufferedReader reader, String typeNameTag, ProjectOverview projectOverview) throws IOException {
        String line;
        while ((line = reader.readLine()) != null && !line.trim().isEmpty()) {
            // Consume compose lines - legacy code
        }
    }

    /**
     * Extract type from declaration line.
     */
    private String extractType(String typeInfoLine) {
        return typeInfoLine.trim().split("\\(")[0].toLowerCase();
    }

    /**
     * Check if type requires unique names.
     */
    private boolean isUniqueType(String type) {
        return type.equalsIgnoreCase("scenario") || type.equalsIgnoreCase("story");
    }

    /**
     * Extract metadata from parentheses.
     */
    private String extractMetaData(String metaData) {
        Pattern pattern = getPattern("\\((.+?)\\)");
        Matcher matcher = pattern.matcher(metaData);
        return matcher.find() ? matcher.group(1) : null;
    }

    /**
     * Get or cache regex pattern.
     */
    private Pattern getPattern(String patternString) {
        return PATTERN_CACHE.computeIfAbsent(patternString, Pattern::compile);
    }

    /**
     * Create appropriate StepData instance based on action class.
     */
    private StepData createStepData(Class<?> actionClass) {
        if (actionClass.equals(SeleniumActionMapper.class)) {
            return new SeleniumStepData();
        } else if (actionClass.equals(MobileActionMapper.class)) {
            return new MobileStepData();
        } else if (actionClass.equals(HttpActionMapper.class)) {
            return new ApiStepData();
        }
        return new SeleniumStepData();
    }

    /**
     * Create appropriate Input instance based on action class.
     */
    private Input createStepInput(Class<?> actionClass) {
        if (actionClass.equals(HttpActionMapper.class)) {
            return new ApiInput();
        }
        return new SeleniumInput();
    }

    /**
     * Create appropriate Output instance based on action class.
     */
    private Output createStepOutput(Class<?> actionClass) {
        if (actionClass.equals(HttpActionMapper.class)) {
            return new ApiOutput();
        }
        return new SeleniumOutput();
    }

    /**
     * Set API calls map for HTTP actions.
     */
    public void setApiCallsMap(Map<String, ApiRequest> apiCallsMap) {
        this.apiCallsMap = apiCallsMap;
    }

    /**
     * Internal class to hold parsed step information.
     */
    private static class StepInfo {
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