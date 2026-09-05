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
 * Natural Language Parser - Primary parser for flow files using pure natural language.
 * 
 * This parser eliminates the need for special delimiters like [+action+], [~locator~], [*data*].
 * Instead, it uses intelligent pattern matching and context-aware parsing to understand
 * natural language step definitions.
 * 
 * Format Examples:
 * - "Click the login button"
 * - "Type admin@example.com into the username field"
 * - "Verify the welcome message appears"
 * - "Navigate to https://example.com"
 * - "Wait for 5 seconds"
 * 
 * The parser uses:
 * 1. Action dictionary to identify valid actions
 * 2. Pattern matching to extract locators (id:, name:, xpath:, etc.)
 * 3. Context-aware parsing to determine data vs locators
 * 4. Optional transformer-based parsing for complex sentences
 */
public class NaturalLanguageParser {

    private static final org.apache.logging.log4j.Logger logger = LogManager.getLogger(NaturalLanguageParser.class);
    
    private static final Map<String, Pattern> PATTERN_CACHE = new ConcurrentHashMap<>();
    
    // Common locator prefixes
    private static final List<String> LOCATOR_PREFIXES = Arrays.asList(
        "id", "name", "xpath", "css", "class", "tag", "link", "partialLink",
        "text", "value", "type", "index", "dom", "js", "accessibility", "image", "coord"
    );
    
    // Common action keywords that indicate data follows
    private static final Set<String> DATA_ACTIONS = new HashSet<>(Arrays.asList(
        "type", "enter", "input", "fill", "set", "write", "send"
    ));
    
    // Common action keywords that indicate navigation
    private static final Set<String> NAVIGATION_ACTIONS = new HashSet<>(Arrays.asList(
        "navigate", "go", "open", "visit", "load"
    ));
    
    // Common action keywords that indicate verification
    private static final Set<String> VERIFICATION_ACTIONS = new HashSet<>(Arrays.asList(
        "verify", "assert", "check", "confirm", "ensure", "validate"
    ));
    
    private final Config config;
    private Map<String, ApiRequest> apiCallsMap = Collections.emptyMap();
    
    // Optional transformer parser for complex sentences
    private TransformerStepParser transformerParser;
    private final boolean useTransformerFallback;
    
    // Confidence threshold for transformer fallback (0.0 to 1.0)
    private double confidenceThreshold = 0.7;

    public NaturalLanguageParser(Config config) {
        this(config, true);
    }

    public NaturalLanguageParser(Config config, boolean useTransformerFallback) {
        this.config = config;
        this.useTransformerFallback = useTransformerFallback;
        new ActionSynonyms(config.getBuildType());
        logger.info("NaturalLanguageParser initialized with transformer fallback: " + useTransformerFallback);
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
     * Parse a single flow file.
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
                    logger.info("waiting for a valid type:{scenario|story|test|compose} to get started...");
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
                parseStepNaturalLanguage(stepNumber, line, stepList);
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
     * Parse a step using natural language parsing.
     */
    private void parseStepNaturalLanguage(int stepNumber, String line, List<ExecutableStep<ActionMapper>> stepList) {
        StepInfo stepInfo = parseStepLine(line);
        
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
            // Handle API reference
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
     * Parse a step line into its components using natural language parsing.
     */
    public StepInfo parseStepLine(String line) {
        String trimmedLine = line.trim();
        
        // Extract output variable if present (e.g., "var:variableName" or "var(variableName)")
        String outputVariable = extractOutputVariable(trimmedLine);
        String lineWithoutOutput = trimmedLine.replaceFirst("(var\\s*:\\s*\\S+)|(var\\s*\\(\\S+\\)\\s*:\\s*\\S+)", "").trim();
        
        // Extract locators (patterns like id:, name:, xpath:, etc.)
        Map<String, String> locators = extractLocators(lineWithoutOutput);
        
        // Remove locators from line for action extraction
        String lineWithoutLocators = removeLocators(lineWithoutOutput, locators);
        
        // Extract action and data
        StepInfo stepInfo = extractActionAndData(lineWithoutLocators);
        stepInfo.locators = locators;
        stepInfo.outputVariable = outputVariable;
        
        return stepInfo;
    }

    /**
     * Extract output variable from line.
     */
    private String extractOutputVariable(String line) {
        // Match var:variableName or var(variableName)
        Pattern pattern = getPattern("(var\\s*:\\s*(\\S+))|(var\\s*\\((\\S+)\\))");
        Matcher matcher = pattern.matcher(line);
        if (matcher.find()) {
            return matcher.group(2) != null ? matcher.group(2) : matcher.group(4);
        }
        return null;
    }

    /**
     * Extract locators from line (patterns like id:, name:, xpath:, etc.).
     */
    private Map<String, String> extractLocators(String line) {
        Map<String, String> locators = new LinkedHashMap<>();
        
        for (String prefix : LOCATOR_PREFIXES) {
            Pattern pattern = getPattern("(?i)\\b" + prefix + "[:=]\\s*(\\S+)");
            Matcher matcher = pattern.matcher(line);
            while (matcher.find()) {
                locators.put(prefix.toLowerCase(), matcher.group(1));
            }
        }
        
        return locators;
    }

    /**
     * Remove locators from line.
     */
    private String removeLocators(String line, Map<String, String> locators) {
        String result = line;
        for (String prefix : locators.keySet()) {
            Pattern pattern = getPattern("(?i)\\b" + prefix + "[:=]\\s*\\S+");
            result = result.replaceAll(pattern.pattern(), "");
        }
        return result.trim();
    }

    /**
     * Extract action name and data from line.
     */
    private StepInfo extractActionAndData(String line) {
        StepInfo stepInfo = new StepInfo();
        
        // Tokenize the line
        String[] tokens = line.split("\\s+");
        if (tokens.length == 0) {
            return stepInfo;
        }
        
        // First token is likely the action
        String potentialAction = tokens[0].toLowerCase();
        
        // Check if it's a known action
        ActionMapper<?> action = ActionDictionaryMapper.getInstance().getAction(potentialAction);
        if (action != null) {
            stepInfo.actionName = potentialAction;
            
            // Remaining tokens are data or locators
            List<String> dataTokens = new ArrayList<>();
            for (int i = 1; i < tokens.length; i++) {
                String token = tokens[i];
                
                // Check if token looks like a locator
                boolean isLocator = false;
                for (String prefix : LOCATOR_PREFIXES) {
                    if (token.toLowerCase().startsWith(prefix + ":") || 
                        token.toLowerCase().startsWith(prefix + "=")) {
                        isLocator = true;
                        break;
                    }
                }
                
                if (!isLocator) {
                    dataTokens.add(token);
                }
            }
            stepInfo.data = dataTokens;
        } else {
            // Try to find action in the middle of the line
            // Common pattern: "Click submit button" -> action=click, target=submit
            for (int i = 0; i < tokens.length; i++) {
                potentialAction = tokens[i].toLowerCase();
                action = ActionDictionaryMapper.getInstance().getAction(potentialAction);
                if (action != null) {
                    stepInfo.actionName = potentialAction;
                    
                    // Everything before is context, everything after is data
                    List<String> dataTokens = new ArrayList<>();
                    for (int j = i + 1; j < tokens.length; j++) {
                        String token = tokens[j];
                        boolean isLocator = false;
                        for (String prefix : LOCATOR_PREFIXES) {
                            if (token.toLowerCase().startsWith(prefix + ":") || 
                                token.toLowerCase().startsWith(prefix + "=")) {
                                isLocator = true;
                                break;
                            }
                        }
                        if (!isLocator) {
                            dataTokens.add(token);
                        }
                    }
                    stepInfo.data = dataTokens;
                    break;
                }
            }
        }
        
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
     * Set transformer fallback threshold.
     */
    public void setConfidenceThreshold(double threshold) {
        this.confidenceThreshold = Math.max(0.0, Math.min(1.0, threshold));
    }

    /**
     * Get transformer parser (lazy initialized).
     */
    private TransformerStepParser getTransformerParser() {
        if (transformerParser == null) {
            transformerParser = new TransformerStepParser();
        }
        return transformerParser;
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