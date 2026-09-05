package com.svatah.automator.client;

import com.svatah.automator.containers.ApiRequest;
import okhttp3.*;

import javax.net.ssl.*;
import java.io.IOException;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.util.concurrent.TimeUnit;

/**
 * Created by AtulSharma on 29/08/18
 */
public class ApiClient {

    private final OkHttpClient client;

    public ApiClient(boolean acceptAllSslCert) {
        if (!acceptAllSslCert)
            client = new OkHttpClient();
        else
            client = getUnsafeOkHttpClient();

        client.newBuilder()
                .readTimeout(120, TimeUnit.SECONDS)
                .writeTimeout(120, TimeUnit.SECONDS)
                .connectTimeout(120, TimeUnit.SECONDS)
                .build();
    }

    public Response request(ApiRequest apiRequest) throws IOException {
        if (apiRequest.url() == null)
            throw new NullPointerException("url can't be null");
        Request.Builder builder = new Request.Builder()
                .url(apiRequest.url());

        switch (apiRequest.httpMethod().getMethod()) {
            case "GET":
                break;
            case "POST":
                builder.post(RequestBody.create(MediaType.get(apiRequest.contentType()), apiRequest.requestBody()));
                break;
            case "PUT":
                builder.put(RequestBody.create(MediaType.get(apiRequest.contentType()), apiRequest.requestBody()));
                break;
            case "PATCH":
                builder.patch(RequestBody.create(MediaType.get(apiRequest.contentType()), apiRequest.requestBody()));
                break;
            case "DELETE":
                if (apiRequest.requestBody() == null)
                    builder.delete();
                else
                    builder.delete(RequestBody.create(MediaType.get(apiRequest.contentType()), apiRequest.requestBody()));
                break;
            default:
                throw new NullPointerException("method can't be null");
        }

        if (apiRequest.headers() != null) {
            for (String key : apiRequest.headers().keySet()) {
                builder.header(key, apiRequest.headers().get(key));
            }
        }

        String cookie = "";
        for (String cookieKey : apiRequest.cookies().keySet()) {
            cookie = cookie + cookieKey + "=" + apiRequest.cookies().get(cookieKey) + ";";
        }
        if (!cookie.equals(""))
            builder.header("Cookie", cookie);
        Request request = builder.build();
        Response response = client.newCall(request).execute();
        //Assertions.assertThat(response.isSuccessful()).isTrue();
        return response;
    }

//    public static void main(String[] args) throws IOException, RequestBuilderException {
//        ApiClient client = new ApiClient(false);
//        RequestBody requestBody = RequestBody.create(MediaType.get("application/json"), "{\"id\":1}");
//        Map<String, String> cookies = new HashMap<>();
//        cookies.put("JSESSIONID", "33C1D9A028F1742AA0C0547E5069FA53");
//        ApiRequest apiRequest = new ApiRequest.RequestBuilder()
//                .httpMethod(HttpMethod.GET)
//                .uri("http://localhost:8095/previous/execution")
//                .contentType("application/json")
//                .cookies(cookies)
//                .build();
//
//        Response response = client.request(apiRequest);
//        System.out.println(response.isSuccessful());
//        String resBody = response.body().string();
//        System.out.println(resBody);
//    }

    private static OkHttpClient getUnsafeOkHttpClient() {
        try {
            // Create a trust manager that does not validate certificate chains
            final TrustManager[] trustAllCerts = new TrustManager[]{
                    new X509TrustManager() {
                        @Override
                        public void checkClientTrusted(java.security.cert.X509Certificate[] chain,
                                                       String authType) throws CertificateException {
                        }

                        @Override
                        public void checkServerTrusted(java.security.cert.X509Certificate[] chain,
                                                       String authType) throws CertificateException {
                        }

                        @Override
                        public java.security.cert.X509Certificate[] getAcceptedIssuers() {
                            return new X509Certificate[0];
                        }
                    }
            };

            // Install the all-trusting trust manager
            final SSLContext sslContext = SSLContext.getInstance("SSL");
            sslContext.init(null, trustAllCerts, new java.security.SecureRandom());
            // Create an ssl socket factory with our all-trusting manager
            final SSLSocketFactory sslSocketFactory = sslContext.getSocketFactory();

            return new OkHttpClient.Builder()
                    .sslSocketFactory(sslSocketFactory, (X509TrustManager) trustAllCerts[0])
                    .hostnameVerifier(new HostnameVerifier() {
                        @Override
                        public boolean verify(String hostname, SSLSession session) {
                            return true;
                        }
                    }).build();

        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}
