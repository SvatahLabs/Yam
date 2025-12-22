package com.svatah.automator.parser;

import com.svatah.automator.containers.*;
import com.svatah.automator.core.Config;
import com.svatah.automator.exceptions.ScenarioParseException;
import com.svatah.automator.mappers.*;
import com.svatah.automator.utils.FileUtil;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class LineParser {

    private static final Logger logger = LogManager.getLogger(LineParser.class);
    private Config config;
    private Map<String, String> locatorMap;
    private Map<String, String> dataMap;
    private Map<String, ApiRequest> apiCallsMap;

    public LineParser(Config config, Map<String, ApiRequest> apiCallsMap) {
        this.config = config;
        this.apiCallsMap = apiCallsMap;
        this.locatorMap = config.getLocatorMapping();
        this.dataMap = config.getDataMapping();
        new ActionSynonyms(config.getBuildType());
    }

    public ExecutableStep<?> lineParser(int lineNumber, String line) throws Exception {
        //Firstly the parser searches for Scenario Keyword to add a scenario to executor.
        //parser needs to determine the type {scenario, story, test, compose}
        /**/
        /*extracting type and typeNameTag it is stored as type:typeNameTag*/

        /*for type=scenario, scenario names should be unique*/

        /*The following loop evaluates the next lines as 'steps' for given 'type:scenario' until it encounters an 'empty' or 'null' line.*/
        //if line starts with "//", then it is treated as a comment line and ignored.
        if (line.startsWith(ProjectKeywords.COMMENT_LINE.getKeyword()))
            return null;

        String[] lineBreakDown = line.split(" ");
        ActionMapper<?> action;
        String actionName = extractData("[+](.*?)[+]", line);
        String locator = null;
        for (String word : lineBreakDown) {
            if (actionName == null) {
                action = ActionDictionaryMapper.getInstance().getAction(word);
                if (action != null)
                    actionName = word;
            }
            if (locator == null) {
                if (word.contains(":"))
                    locator = word;
                else
                    locator = locatorMap.getOrDefault(word, null);
            }
            if (actionName != null && locator != null)
                break;
        }

        StepData stepData;
        Input input;
        Output output;
        //List<String> stepValues = extractData("[@](.*?)[\\s]|['](.*?)[']|[~](.*?)[~]", line);
        if (actionName == null || actionName.equals(""))
            throw new ScenarioParseException("Did not find corresponding intent mapping for step : " + line, new FlowValidationErrorDetails("repl", "repl", lineNumber, line, ParseExceptionType.INTENT_MAPPING_ISSUE, "Did you specify intent?", "define valid intent as : +intent+"));
        action = ActionDictionaryMapper.getInstance().getAction(actionName);
        Class<?> classVar = ActionDictionaryMapper.getInstance().getActionClass(action);
        if (classVar == null) {
            throw new ScenarioParseException("Did not find corresponding action mapping for key : " + actionName, new FlowValidationErrorDetails("repl", "repl", lineNumber, line, ParseExceptionType.INTENT_MAPPING_ISSUE, "Did not find corresponding intent mapping for key : " + actionName, "define valid intent as : +intent+"));
        }
        if (classVar.equals(SeleniumActionMapper.class)) {
            stepData = new SeleniumStepData();
            input = new SeleniumInput();
            output = new SeleniumOutput();
        } else if (classVar.equals(MobileActionMapper.class)) {
            stepData = new MobileStepData();
            input = new SeleniumInput();
            output = new SeleniumOutput();
        } else if (classVar.equals(HttpActionMapper.class)) {
            stepData = new ApiStepData();
            input = new ApiInput();
            output = new ApiOutput();
        } else {
            stepData = new SeleniumStepData();
            input = new SeleniumInput();
            output = new SeleniumOutput();
        }
        if (action == null)
            throw new ScenarioParseException("Did not find corresponding intent mapping for key : " + actionName, new FlowValidationErrorDetails("repl", "repl", lineNumber, line, ParseExceptionType.INTENT_MAPPING_ISSUE, "Did not find corresponding intent mapping for key : " + actionName, "define valid intent as : +intent+"));
        String dataSet = extractData("[*](.*?)[*]", line);
        if (dataSet != null) {
            //RULE : Input data set is a list of strings separated by comma
            //RULE : Input data can be a variable.  If so, then it should start with a HASH
            //RULE : Input data as variables from different story/scenario must start with a HASH followed by story/scenario name, then a dot and then the variable name
            List<String> dataList = FileUtil.commaSplitter(dataSet);
            input.setInputDataList(dataList);
        } else {
            input.setInputDataList(Collections.EMPTY_LIST);
        }
        boolean locatorRequired = classVar.equals(SeleniumActionMapper.class) ? !LocatorNotRequiredMapper.getActionsWithoutLocatorsSet().contains(action) : (!classVar.equals(MobileActionMapper.class) || !LocatorNotRequiredMapper.getMobileActionsWithoutLocatorsSet().contains(action));
        //System.out.println("is locator required for "+ actionName +"? " + locatorRequired);
        if (!classVar.equals(HttpActionMapper.class) && locatorRequired) {
            String identityInfo = extractData("[~](.*?)[~]", line);
            List<String> locatorList = Collections.emptyList();
            if (identityInfo != null) {
                identityInfo = identityInfo.trim();
                if (identityInfo.contains(":"))
                    locatorList = Arrays.asList(identityInfo.split(ProjectKeywords.AND.getKeyword()));
                else {
                    if (config.getLocatorMapping().containsKey(identityInfo)) {
                        String value = config.getLocatorMapping().get(identityInfo);
                        locatorList = Arrays.asList(value.split(ProjectKeywords.AND.getKeyword()));
                    } else {
                        throw new ScenarioParseException(scenarioExceptionMessage(line) + " check > " + identityInfo + " for errors.", new FlowValidationErrorDetails("repl", "repl", lineNumber, line, ParseExceptionType.IDENTITY_MAPPING_ISSUE, scenarioExceptionMessage(line), " check > locatorDetails : " + identityInfo + " for errors."));
                    }
                }
            } else {
                if (locator != null)
                    locatorList = Arrays.asList(locator.split(ProjectKeywords.AND.getKeyword()));
                else {
                    logger.error("locator not found, does this line require a locator? " + scenarioExceptionMessage(line));
                    throw new ScenarioParseException(scenarioExceptionMessage(line), new FlowValidationErrorDetails("repl", "repl", lineNumber, line, ParseExceptionType.IDENTITY_MAPPING_ISSUE, scenarioExceptionMessage(line), " please define identity (locator) for intent : " + actionName));
                }
            }
            LocatorMap locatorMap = new LocatorMap();
            for (String locatorDetails : locatorList) {
                String[] kv = new String[2];
                try {
                    kv[0] = locatorDetails.substring(0, locatorDetails.indexOf(":"));
                    kv[1] = locatorDetails.substring(locatorDetails.indexOf(":") + 1);
                    logger.info("locatorType : " + kv[0] + ", locator : " + kv[1]);
                } catch (Exception e) {
                    logger.info(scenarioExceptionMessage(line));
                    throw new ScenarioParseException(scenarioExceptionMessage(line) + " check > " + locatorDetails + " for errors.", new FlowValidationErrorDetails("repl", "repl", lineNumber, line, ParseExceptionType.IDENTITY_MAPPING_ISSUE, scenarioExceptionMessage(line), " check > locatorDetails : " + locatorDetails + " for errors."));
                }
                if (LocatorType.getLocatorType(kv[0].trim()) == null)
                    throw new ScenarioParseException(scenarioExceptionMessage(line) + " check > " + locatorDetails + " for errors.", new FlowValidationErrorDetails("repl", "repl", lineNumber, line, ParseExceptionType.IDENTITY_MAPPING_ISSUE, scenarioExceptionMessage(line), " This is not a valid locator type : " + kv[0].trim()));
                locatorMap.addTypeAndLocator(LocatorType.getLocatorType(kv[0].trim()), kv[1].trim());
            }
            input.set(locatorMap);
        } else if (classVar.equals(HttpActionMapper.class)) {
            String identityInfo = extractData("[~](.*?)[~]", line);
            ApiRequest apiRequest = apiCallsMap.get(identityInfo);
            if (apiRequest == null)
                throw new ScenarioParseException(scenarioExceptionMessage(line) + " check > '" + identityInfo + "' for errors. There is no api call saved with this name.", new FlowValidationErrorDetails("repl", "repl", lineNumber, line, ParseExceptionType.API_CALL_NOT_FOUND, scenarioExceptionMessage(line), " There is no api call saved with this name : " + identityInfo));
            input.set(apiRequest);
        }

        String stepVariable = extractData("var\\s*:\\s*(\\S+)", line);
        if (stepVariable == null) {
            String arr[] = extractData("var\\s*[(](.*?)[)]\\s*:\\s*(\\S+)", line, new int[]{1, 2});
            output.set(arr[0]);
            stepVariable = arr[1];
        }

        stepData.setInputData(input);
        stepData.setOutputData(output);
        return new ExecutableStep<>(actionName, action, stepData, stepVariable);
    }

    private String extractData(String patternString, String data) {
        List<String> dataSet = new ArrayList<>();
        Pattern pattern = Pattern.compile(patternString);
        Matcher matcher = pattern.matcher(data);
        while (matcher.find()) {
            dataSet.add(matcher.group(1));
        }
        if (dataSet.isEmpty())
            return null;
        return dataSet.get(0);
    }

    private String[] extractData(String patternString, String data, int[] group) {
        String[] dataSet = new String[group.length];
        Pattern pattern = Pattern.compile(patternString);
        Matcher matcher = pattern.matcher(data);
        while (matcher.find()) {
            for (int i = 0; i < group.length; i++)
                dataSet[i] = matcher.group(group[i]);
        }
        return dataSet;
    }

    private String scenarioExceptionMessage(String errorMessage) {
        return "Format error in line : " + errorMessage + ". Please refer the flow creation documentation.";
    }

}
