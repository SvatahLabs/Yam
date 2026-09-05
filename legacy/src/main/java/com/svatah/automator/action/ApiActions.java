package com.svatah.automator.action;

import com.jayway.jsonpath.JsonPath;
import com.svatah.automator.client.ApiClient;
import com.svatah.automator.containers.ApiRequest;
import com.svatah.automator.containers.ApiStepData;
import com.svatah.automator.containers.ReturnType;
import com.svatah.automator.exceptions.InvalidStepDataException;
import com.svatah.automator.mappers.HttpActionMapper;
import okhttp3.Response;
import org.openqa.selenium.Cookie;
import org.openqa.selenium.WebDriver;

import java.io.IOException;
import java.util.Iterator;
import java.util.Set;

/**
 * Created by AtulSharma on 14/09/18
 */
public class ApiActions implements Action<WebDriver, HttpActionMapper, ApiStepData> {

    @Override
    public ReturnType<?> perform(WebDriver driver, HttpActionMapper action, ApiStepData apiStepData) throws InvalidStepDataException {
        ReturnType<String> returnType = new ReturnType<>(String.class);
        ApiClient apiClient = new ApiClient(apiStepData.getInputData().get().acceptAllSslCert());
        ApiRequest request = apiStepData.getInputData().get();

        switch (action.getAction()) {
            case "INVOKE":
                try {
                    Set<Cookie> cookies = driver.manage().getCookies();
                    Iterator<Cookie> iterator = cookies.iterator();
                    while (iterator.hasNext()) {
                        Cookie cookie = iterator.next();
                        request.cookies().put(cookie.getName(), cookie.getValue());
                    }
                    Response response = apiClient.request(request);
                    String responseBody = response.body() != null ? response.body().string() : null;
                    if (responseBody != null && apiStepData.getOutputData() != null && apiStepData.getOutputData().get() != null) {
                        returnType.setValue(JsonPath.parse(responseBody).read(apiStepData.getOutputData().get()));
                    } else {
                        returnType.setValue(responseBody);
                    }
                } catch (IOException e) {
                    throw new InvalidStepDataException(e);
                }
                break;
            case "INVOKE WITHOUT COOKIE":
                try {
                    Response response = apiClient.request(request);
                    String responseBody = response.body() != null ? response.body().string() : "";
                    if (apiStepData.getOutputData().get() != null)
                        returnType = JsonPath.parse(responseBody).read(apiStepData.getOutputData().get());
                    else {
                        returnType = new ReturnType<>(String.class);
                        returnType.setValue(JsonPath.parse(responseBody).jsonString());
                    }
                } catch (IOException e) {
                    e.printStackTrace();
                }
                break;
            default:
                break;

        }
        return returnType;
    }
}
