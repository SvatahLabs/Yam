**Project Automator**
-
> Project Automator's purpose is to automate the tasks to functionally validate any Web UI using Selenium so anyone can focus more on development rather than on regression. 

Change Log
-

v 1.0.3

* Added Support for 17 new actions (windows interaction, mouse and key interactions)
* Added timeout support in API Client.
* Added Class to maintain actions which does not require locators.
* Upgraded dependency versions for web driver manager and logger.

v 1.0.1

* Added Support for interacting element highlight
* Element screenshot support tested but there is a bug with chromedriver, need to investigate more.
* Upgraded selenium dependency versions.

*Salient Features*
-
* Supports Behaviour Driven Approach
* Eliminates the need to write plumbing code.
* Requires minimal effort to setup project
* Extensible to support complex scenarios

* Extensible to support complex scenarios

**Getting Started**
-
### Prerequisites
*   **Java 8**: The project is configured to be compatible with Java 8. Ensure your `JAVA_HOME` is set to a Java 8 JDK.

### Build Instructions
The project uses Gradle for building and dependency management.

1.  **Clean and Build**:
    To compile the project and run tests:
    ```bash
    ./gradlew clean build
    ```

2.  **Generate Shadow JAR**:
    To create a fat JAR (uber-jar) containing all dependencies (useful for distribution):
    ```bash
    ./gradlew shadowJar
    ```
    The generated JAR will be located at: `build/libs/svatah-core-<version>-all.jar`

*How to run*
-
* Define a flow file.
* Define run configuration (*Config.java*)
* Choose an executor (internal : AutomatorController.java or custom defined )
* Run via main action.(refer *ScenarioRunner.java*)

**ScenarioRunner.java**
-
```
public class ScenarioRunner {

   //Starting point for the regression.
   public static void main(String[] args) throws Exception {
           ScenarioRunner run = new ScenarioRunner();
           run.allTests();
       }

   private Config config() throws IOException {

           return new Config.ConfigBuilder()
                   .safeMode(false)
                   .url("https://www.svatah.in")
                   .browser("chrome")
                   .threadCount(1)
                   .takeStepScreenshot(false)
                   .locatorMapping(locatorMapping)
                   .flowsRootPath(System.getProperty("user.dir") + "/src/test/resources")
                   .systemProperty("selenium.hub.address", "http://localhost:4444/wd/hub/")
                   .systemProperty("webdriver.gecko.driver", System.getProperty("user.dir") + "/src/test/resources/drivers/geckodriver")
                   .systemProperty("webdriver.chrome.driver", System.getProperty("user.dir") + "/src/test/resources/drivers/chromedriver_mac_240")
                   .build();
       }

   public void allTests() {
           ExecutionController controller = new AutomatorController();
           try {
                  controller.execute(Thread.currentThread().getId(), config());
                  List<StepResultInfo> resultInfoList = ThreadedDataHandler.getInstance().getResults(Thread.currentThread().getId()).getResultInfoList();
                    for (StepResultInfo event: resultInfoList) {
                        System.out.println(event.toString());
                        if(!event.resultStatus())
                            System.out.println(event.getFailureStackTraceAsString());
                        }
               } catch (IOException | InstantiationException e) {
                  e.printStackTrace();
               }
      }

}
```

**Expression & Syntax**
-
Flow file constitutes the core of Automator framework.  It imbibes the behaviour driven approach by  allowing you to verbosely express the UI flow you want to validate (which then is used in descriptive reporting) and uses expressions in steps to drive the flow.
There are two parsers currently. Current build is using simplified parser.

**Syntax for Simplified Parser:**
-
Flows constitutes the core of Svatah. It imbibes the behaviour driven approach by allowing you to verbosely express the UI flow you want to validate (which then is used in descriptive reporting) and uses expressions in steps to drive the flow. A typical expression is defined by their respective type tags.
Actions should be defined within pair of plus symbols : +action+
Locator should be defined within pair of tilda symbols : ~locator_type : locator~
Data should be defined within pair of multiply symbols : *outputData*

**Step definition**
-
A Step definition is logically one unique action which you want to perform on the web UI. A Step consist of 3 mandatory expression and an optional expression:

Action Expression : `+<Action_Type>+`
Locator Type Declaration : `~<Locator_Type> : <Locator>~` based on whether you want to pass locator information directly from step or from a property file.
Data feed : `*<Data >*` (optional, if the step requires outputData feed.)

A typical step looks like:
`+type+ the username *user@svatah.com* in field ~id:username~`

note : check reference for action type and locator type mappings.

**Scenario definition**
-
A typical scenario consist of multiple steps definitions which are executed sequentially. A scenario is logically modular grouping of steps which makes up a business functionality. A scenario starts with BEGIN keyword in a new line and stops at END keyword. A scenario must have unique url across the project as a scenario can be reused by another flow. A typical scenario looks like:

```
scenario : ValidateText
+type+ the username *user@svatah.com* in field ~id:username~
+type+ the password *abcd1234* in ~id:password~
+click+ on the login button using ~xpath://input[@value='Sign In']~
+click+ on the Schedule Build using ~xpath://li[4]/a/p~
+validateText+ on the Schedule Build Page using ~xpath://h1~ with *Schedule*
```

**Flow definition**
-
A typical flow consist of multiple scenarios which are executed sequentially. A flow is logically a UI functional flow where you perform a business decision. A typical flow is defined in a single flow file. Flow files in turn can be executed in parallel thus reducing the overall execution time. A typical flow looks like:

```
scenario : ValidateText404
+type+ the username *user@svatah.com* in field ~id:username~
+type+ the password *abcd1234* in ~id:password~
+click+ on the login button using ~xpath://input[@value='Sign In']~
+click+ on the Schedule Build using ~xpath://li[4]/a/p~
+validateText+ on the Schedule Build Page using ~xpath://h1~ with *404 Error.*


scenario : ValidateText
+validateText+ on the Schedule Build Page using ~xpath://h1~ with *Schedule*
```

You are now ready to start creating your own flows.

**Syntax for Svatah Parser:**
-
A typical expression is defined by tag : `$[key : value]$`


**Step definition**
-
A Step definition is logically one unique action which you want to perform on the web UI. A Step consist of 3 mandatory expression and an optional expression:

1. Action Expression : `$[ action : <ACTION_TYPE> ]$`
2. Locator Type Declaration : `$[ locatorType : <LOCATOR_TYPE> ]$`
3. Locator definition : `$[ locator : <LOCATOR> ]$` or `$[ locator : #<LOCATOR># ]$`  based on whether you want to pass locator information directly from step or from a property file.
4. Data feed : `$[ outputData : <ACTION_TYPE> ]$` (optional, if the step requires outputData feed.)

A typical step looks like:

`Step 1 - $[action:type]$ the username $[outputData:username]$ in field $[locatorType:url]$ using locator $[locator:uid]$`

*see appendix for action type and locator type mappings.


**Scenario definition**
-
A typical scenario consist of multiple steps definitions which are executed sequentially. A scenario is logically modular grouping of steps which makes up a business functionality.

A scenario starts with **BEGIN** keyword in a new line and stops at **END** keyword. A scenario must have *unique url across the project* as a scenario can be reused by another flow.

A typical scenario looks like:

```
Begin
$[scenario : EnterName]$
Step 1 - open login page and $[action:clear]$ the $[locatorType:url]$ field using locator $[locator:#username#]$
Step 2 - then $[action:type]$ the username $[outputData:user@sprinklr.com]$ in field $[locatorType:url]$ using locator $[locator:uid]$
Step 3 - $[action:wait]$ for $[outputData: 5]$ seconds
Step 4 - then $[action:click]$ on next button having field $[locatorType:cssSelector]$ and locator $[locator:button.btn.btn-login]$
End
```

**Flow definition**
-
A typical flow consist of multiple scenarios which are executed sequentially. A flow is logically a UI functional flow where you perform a business decision. A typical flow is defined in a single flow file. Flow files in turn can be executed in parallel thus reducing the overall execution time.

A typical flow looks like:

Flow File : *login.flow*

```
Begin
$[scenario : EnterName]$
// This scenario is to enter user url
Step 1 - open login page and $[action:clear]$ the $[locatorType:url]$ field using locator $[locator:#username#]$
Step 2 - then $[action:type]$ the username $[outputData:user@sprinklr.com]$ in field $[locatorType:url]$ using locator $[locator:uid]$
Step 3 - $[action:wait]$ for $[outputData: 5]$ seconds
Step 4 - then $[action:click]$ on next button having field $[locatorType:cssSelector]$ and locator $[locator:button.btn.btn-login]$
End

Begin
$[scenario : EnterPassword]$
Step 1 - on Password page $[action:clear]$ the $[locatorType:url]$ field using locator $[locator:pass]$
Step 2 - then $[action:type]$ the password $[outputData:password]$ in field $[locatorType:url]$ using locator $[locator:pass]$
Step 3 - $[action:wait]$ for $[outputData: 5]$ seconds
Step 4 - then $[action:click]$ on next button having field $[locatorType:cssSelector]$ and locator $[locator:div.spr > button.btn.btn-login]$
End
```

