package com.svatah.automator;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.stream.JsonReader;
import com.svatah.automator.containers.*;
import com.svatah.automator.controller.AutomatorController;
import com.svatah.automator.controller.ExecutionController;
import com.svatah.automator.controller.ReplExcecutionController;
import com.svatah.automator.core.Config;
import com.svatah.automator.exceptions.RequestBuilderException;
import com.svatah.automator.exceptions.ScenarioParseException;
import com.svatah.automator.mappers.BuildType;
import com.svatah.automator.mappers.HttpMethod;
import com.svatah.automator.mappers.SeleniumActionMapper;
import com.svatah.automator.parser.FlowValidationErrorDetails;
import com.svatah.automator.parser.LineParser;
import com.svatah.automator.parser.SvatahParserV2;
import com.svatah.automator.utils.FileUtil;
import com.svatah.automator.utils.Logging;

import java.io.*;
import java.util.*;

/**
 * Created by atul on 12/09/17.
 */
public class ScenarioValidationTest {

    public ScenarioValidationTest() {
    }

    public static void main(String[] args) throws RequestBuilderException, IOException {
        ScenarioValidationTest test = new ScenarioValidationTest();
        //test.replConsole();
        test.singleExecutorTest();
    }

    private Config config() throws IOException {
        JsonReader reader = new JsonReader(new FileReader("src/main/resources/svatahDesktopConfig.json"));
        JsonObject jsonObject = new Gson().fromJson( reader, JsonObject.class);
        String [] buildType = new String[1];
        String [] browser = new String[1];
        Map<String, String> capabilities = new HashMap<>();
        List<String> browserOptions = new ArrayList<>();

        jsonObject.keySet().forEach(key -> {
            switch (key) {
                case "capabilities":
                    jsonObject.get(key).getAsJsonObject().keySet().forEach(capKey -> {
                        System.out.println(capKey + " = " + jsonObject.get(key).getAsJsonObject().get(capKey).toString());
                        capabilities.put(capKey, jsonObject.get(key).getAsJsonObject().get(capKey).getAsString());
                    });
                    break;
                case "browserOptions":
                    jsonObject.get(key).getAsJsonObject().getAsJsonArray("args").forEach(val -> {
                        browserOptions.add(val.getAsString());
                    });
                    break;
                case "buildType":
                    buildType[0] = jsonObject.get(key).getAsString();
                    break;
                case "browser":
                    browser[0] = jsonObject.get(key).getAsString();
                    break;
            }
        });

        return new Config.ConfigBuilder()
                .safeMode(false)
                .url("https://www.svatah.in/")
                .browser(browser[0].toLowerCase())
                .threadCount(1)
                .buildType(BuildType.valueOf(buildType[0].toUpperCase()))
                .takeStepScreenshot(true)
                .locatorMapping(FileUtil.getKeyValueMap(System.getProperty("user.dir")+"/src/test/resources/locator/svatah.locator"))
                .dataMapping(FileUtil.getKeyValueMap(System.getProperty("user.dir")+"/src/test/resources/store/svatah.data"))
                .flowsRootPath(System.getProperty("user.dir") + "/src/test/resources")
                .capabilitiesMap(capabilities)
                .browserOptions(browserOptions)
                .build();
    }

    void replConsole() throws RequestBuilderException, IOException{
        ApiRequest request = new ApiRequest.RequestBuilder()
                .uri("https://www.svatah.in")
                .path("/active/count")
                .acceptAllSslCert(true)
                .httpMethod(HttpMethod.GET)
                .build();
        Map<String, ApiRequest> apiRequestMap = new HashMap<>();
        apiRequestMap.put("active count", request);
        ReplExcecutionController<SeleniumActionMapper> replExcecutionController = new ReplExcecutionController<>(config(), apiRequestMap);
        String line;
        int counter = 0;
        System.out.println("---------------- Welcome to Svatah's REPL Console ---------------");
        System.out.println("");
        do {
            counter++;
            System.out.print("command : ");
            line = new Scanner(System.in).nextLine();
            if(!line.equals("exit")) {
                try {
                    replExcecutionController.execute(counter, line);
                } catch (Exception | Error e) {
                    System.out.println("caught error : " + e.getMessage());
                }
            }
        } while (!line.equals("exit"));
        System.out.println("------------------- Bye! Svatah's REPL Console ------------------");
        replExcecutionController.exit();
    }

    public void executorTest() {
        try {
            ExecutionController<?> controller = new AutomatorController();
            controller.execute(Thread.currentThread().getId(), config(), Collections.emptyMap());
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    public void singleExecutorTest() {
        List<File> executableFlows = new ArrayList<>();
        //List of executable flow files
        executableFlows.add(new File("src/test/resources/sample/svatah.flow"));
        //List of Files Which contains depending scenarios but the flows need not be executed(these flows won't be executed separately)
        List<File> dependenceList = new ArrayList<>();
        try {
            ApiRequest request = new ApiRequest.RequestBuilder()
                    .uri("https://www.svatah.in")
                    .path("/active/count")
                    .acceptAllSslCert(true)
                    .httpMethod(HttpMethod.GET)
                    .build();
            Map<String, ApiRequest> apiRequestMap = new HashMap<>();
            apiRequestMap.put("active count", request);
            ExecutionController<?> controller = new AutomatorController();
            controller.execute(Thread.currentThread().getId(), config(), executableFlows, dependenceList, apiRequestMap);
            List<StepResultInfo> resultInfoList = ThreadedDataHandler.getInstance().getResults(Thread.currentThread().getId()).getResultInfoList();
            int passed=0, failed=0, skipped=0;
            for (StepResultInfo result: resultInfoList) {
                if(result.resultStatus())
                    passed++;
                else{
                    if(result.getFailureMessage().equals("skipped"))
                        skipped++;
                    else
                        failed++;
                }
                System.out.println(result.toString());
//                if(!result.resultStatus() && result.getFailureStackTrace()!=null)
//                    System.out.println(result.getFailureStackTraceAsString());
            }
            System.out.println(passed+" steps passed, "+failed+" steps failed and "+skipped+" steps were skipped.");
        } catch (IOException | RequestBuilderException | NullPointerException e) {
            e.printStackTrace();
        }
    }

    private void svatahParserV2ValidatorTest() throws IOException, RequestBuilderException {
        ApiRequest request = new ApiRequest.RequestBuilder()
                .uri("https://www.svatah.in")
                .path("/active/count")
                .acceptAllSslCert(true)
                .httpMethod(HttpMethod.GET)
                .build();
        Map<String, ApiRequest> apiRequestMap = new HashMap<>();
        apiRequestMap.put("active count", request);
        SvatahParserV2 parser = new SvatahParserV2(config());
        parser.setApiCallsMap(apiRequestMap);
        List<File> executableFlows = new ArrayList<>();
        //List of executable flow files
        executableFlows.add(new File("src/test/resources/sample/svatah.flow"));

        List<FlowValidationErrorDetails> errorDetailsList = parser.validate(Long.parseLong("1"), executableFlows);
        if (errorDetailsList.isEmpty())
            System.out.println("Validation passed");
        else {
            System.out.println("validation failed :");
            System.out.println("-------------------");
            int index = 0;
            for (FlowValidationErrorDetails errorDetails : errorDetailsList) {
                index++;
                System.out.println(index + " > " + errorDetails.toString());
            }
        }
    }

    private void replExecutionControllerTest() throws Exception {
        ApiRequest request = new ApiRequest.RequestBuilder()
                .uri("https://www.svatah.in")
                .path("/active/count")
                .acceptAllSslCert(true)
                .httpMethod(HttpMethod.GET)
                .build();
        Map<String, ApiRequest> apiRequestMap = new HashMap<>();
        apiRequestMap.put("active count", request);
        ReplExcecutionController<SeleniumActionMapper> replExcecutionController = new ReplExcecutionController<>(config(), apiRequestMap);
        replExcecutionController.execute(1, "user +clicks+ on ~css:body>nav>div>div.navbar-translate>button~");
        replExcecutionController.execute(2, "user +moves to element and click+ ~xpath://a[contains(@href,'/login')]~");
        replExcecutionController.exit();
    }

    private void lineParserTest() throws Exception {
        ApiRequest request = new ApiRequest.RequestBuilder()
                .uri("https://www.svatah.in")
                .path("/active/count")
                .acceptAllSslCert(true)
                .httpMethod(HttpMethod.GET)
                .build();
        Map<String, ApiRequest> apiRequestMap = new HashMap<>();
        apiRequestMap.put("active count", request);
        LineParser parser = new LineParser(config(), apiRequestMap);
        ExecutableStep<?> step = parser.lineParser(1, "user +clicks+ on ~css : body > nav > div > div.navbar-translate > button~");
        System.out.println(step.toString());
    }

    public void svatahParserV2Test() {
        try {
            SvatahParserV2 parser = new SvatahParserV2(config());
            parser.loadScenarios(Long.parseLong("1"));
            Map<String, ScenarioDetails> scenarios = ThreadedDataHandler.getInstance().getProjectOverview(Thread.currentThread().getId()).getScenariosDetails();

            for (String key : scenarios.keySet()) {
                Logging.console("Scenario name : " + key);
                Logging.console("DataProvider : " + scenarios.get(key).getScenarioMetaData().getDataProvider());
                Logging.console("FilePath : " + scenarios.get(key).getScenarioMetaData().getFilePath());
                for (Object executableStep : scenarios.get(key).getExecutableSteps()) {
                    ExecutableStep<SeleniumActionMapper> step = (ExecutableStep<SeleniumActionMapper>) executableStep;
                    Logging.console("actionName : " + step.getActionName() + ", action : " + step.getActionMapping() + ",  locator mapping: " + step.getStepData().getInputData().get() +
                            ", data : " + step.getStepData().getOutputData());
                }
                Logging.console("");
            }
            Logging.console("\n");
            System.out.println(ThreadedDataHandler.getInstance().getProjectOverview(Thread.currentThread().getId()).getFlowExecutionOrder().toString());
        } catch (ScenarioParseException spe) {
            System.out.println(spe.getErrorDetails());
            spe.printStackTrace();
        }
        catch (IOException e) {
            e.printStackTrace();
        }
    }
}
