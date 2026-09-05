package com.svatah.automator.containers;

import com.svatah.automator.exceptions.RequestBuilderException;
import com.svatah.automator.mappers.HttpMethod;
import com.svatah.automator.utils.FileUtil;

import java.util.HashMap;
import java.util.Map;

/**
 * Created by AtulSharma on 14/09/18
 */

public class ApiRequest {

    private HttpMethod httpMethod;
    private String url;
    private Map<String, String> basicAuth;
    private Map<String, String> headers;
    private Map<String, Object> formParams;
    private String requestBody;
    private String contentType;
    private Map<String, String> cookies;
    private boolean followRedirect;
    private boolean acceptAllSslCert;
    private String fileName;
    private String filePath;
    private String fileMimeType;

    ApiRequest(RequestBuilder requestBuilder) {
        this.httpMethod = requestBuilder.httpMethod;
        this.contentType = requestBuilder.contentType;
        this.url = requestBuilder.url;
        this.basicAuth = requestBuilder.basicAuth;
        this.requestBody = requestBuilder.requestBody;
        this.cookies = requestBuilder.cookies;
        this.headers = requestBuilder.headers;
        this.formParams = requestBuilder.formParamMap;
        this.followRedirect = requestBuilder.followRedirect;
        this.acceptAllSslCert = requestBuilder.acceptAllSslCert;
        this.fileName = requestBuilder.fileName;
        this.filePath = requestBuilder.filePath;
        this.fileMimeType = requestBuilder.fileMimeType;
    }

    public HttpMethod httpMethod() {
        return httpMethod;
    }

    public String contentType() {
        return contentType;
    }

    public String url() {
        return url;
    }

    public String requestBody() {
        return requestBody;
    }

    public Map<String, String> cookies() {
        return cookies;
    }

    public Map<String, String> headers() {
        return headers;
    }

    public Map<String, Object> formParams() {
        return formParams;
    }

    public boolean followRedirect() {
        return followRedirect;
    }

    public boolean acceptAllSslCert() {
        return acceptAllSslCert;
    }

    public String fileName() {
        return fileName;
    }

    public String filePath() {
        return filePath;
    }

    public String fileMimeType() {
        return fileMimeType;
    }

    public Map<String, String> basicAuth() {
        return basicAuth;
    }

    @Override
    public String toString() {
        return "{" +
                "httpMethod=" + httpMethod +
                ", url='" + url + '\'' +
                ", basicAuth=" + basicAuth +
                ", headers=" + headers +
                ", formParams=" + formParams +
                ", requestBody='" + requestBody + '\'' +
                ", contentType='" + contentType + '\'' +
                ", cookies=" + cookies +
                ", followRedirect=" + followRedirect +
                ", acceptAllSslCert=" + acceptAllSslCert +
                ", fileName='" + fileName + '\'' +
                ", uploadFile='" + filePath + '\'' +
                ", fileMimeType='" + fileMimeType + '\'' +
                '}';
    }

    public static class RequestBuilder {

        private HttpMethod httpMethod;
        private String contentType;
        private String uri;
        private String path;
        private String requestBody;
        private Map<String, String> basicAuth = new HashMap<>();
        private Map<String, String> cookies = new HashMap<>();
        private Map<String, String> headers = new HashMap<>();
        private Map<String, Object> queryParamMap = new HashMap<>();
        private Map<String, Object> pathParamMap = new HashMap<>();
        private Map<String, Object> formParamMap = new HashMap<>();
        private boolean followRedirect = true;
        private boolean acceptAllSslCert = false;
        private String fileName;
        private String filePath;
        private String fileMimeType;
        private String url;
        private int port = -1;

        public RequestBuilder httpMethod(HttpMethod httpMethod) {
            this.httpMethod = httpMethod;
            return this;
        }

        public RequestBuilder contentType(String contentType) {
            this.contentType = contentType;
            return this;
        }

        public RequestBuilder uri(String uri) {
            this.uri = uri;
            return this;
        }

        public RequestBuilder path(String path) {
            this.path = path;
            return this;
        }

        public RequestBuilder requestBody(String requestBody) {
            this.requestBody = requestBody;
            return this;
        }

        public RequestBuilder cookies(Map<String, String> cookies) {
            this.cookies = cookies;
            return this;
        }

        public RequestBuilder addCookie(String key, String value) {
            this.cookies.put(key, value);
            return this;
        }

        public RequestBuilder headers(Map<String, String> headers) {
            this.headers.putAll(headers);
            return this;
        }

        public RequestBuilder addHeader(String key, String value) {
            this.headers.put(key, value);
            return this;
        }


        public RequestBuilder addPathParam(String key, Object value) {
            this.pathParamMap.put(key, value);
            return this;
        }

        public RequestBuilder addQueryParam(String key, Object value) {
            this.queryParamMap.put(key, value);
            return this;
        }

        public RequestBuilder addFormParam(String key, Object value) {
            this.formParamMap.put(key, value);
            return this;
        }

        public RequestBuilder pathParams(Map<String, Object> pathParamMap) {
            this.pathParamMap.putAll(pathParamMap);
            return this;
        }

        public RequestBuilder queryParams(Map<String, Object> queryParamMap) {
            this.queryParamMap.putAll(queryParamMap);
            return this;
        }

        public RequestBuilder formParams(Map<String, Object> formParamMap) {
            this.formParamMap.putAll(formParamMap);
            return this;
        }

        public RequestBuilder followRedirect(boolean followRedirect) {
            this.followRedirect = followRedirect;
            return this;
        }

        public RequestBuilder acceptAllSslCert(boolean acceptAllSslCert) {
            this.acceptAllSslCert = acceptAllSslCert;
            return this;
        }

        public RequestBuilder uploadFile(String filePath) {
            this.filePath = filePath;
            return this;
        }

        public RequestBuilder uploadFile(String fileName, String filePath) {
            this.fileName = fileName;
            this.filePath = filePath;
            return this;
        }

        public RequestBuilder uploadFile(String fileName, String filePath, String fileMimeType) {
            this.fileName = fileName;
            this.filePath = filePath;
            this.fileMimeType = fileMimeType;
            return this;
        }

        public RequestBuilder port(int port) {
            this.port = port;
            return this;
        }

        public RequestBuilder basicAuth(String userName, String password) {
            this.basicAuth.put("username", userName);
            this.basicAuth.put("password", password);
            return this;
        }

        public ApiRequest build() throws RequestBuilderException {
            validateRequest();
            return new ApiRequest(this);
        }

        private void validateRequest() throws RequestBuilderException {
            if (httpMethod == null) {
                throw new RequestBuilderException("HTTP/S REQUEST TYPE IS MANDATORY. (GET, POST, PUT, PATCH, DELETE etc)");
            } else if (httpMethod == HttpMethod.GET) {
                if (this.requestBody != null) {
                    throw new RequestBuilderException("GET Type of api call doesn't accept content.");
                }
                if (this.filePath != null) {
                    throw new RequestBuilderException("GET Type of api call doesn't require uploadFile.");
                }
            }
            StringBuilder url = new StringBuilder();
            if (uri != null && !uri.equals("")){
                url.append(uri);
                if (path != null && !path.equals(""))
                    url.append(path);
            }
            else
                throw new RequestBuilderException("URI is a mandatory field.");
            if(port>0)
                url.append(":").append(port);
            if(!queryParamMap.isEmpty()){
                url.append("?");
                for(String key : queryParamMap.keySet()){
                    url.append(key).append("=").append(queryParamMap.get(key)).append("&");
                }
            }
            this.url = FileUtil.replaceLast(url.toString(), "&", "");
        }
    }
}
