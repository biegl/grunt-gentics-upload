/*
 * uploadGentics
 *
 *
 * Copyright (c) 2014 Markus Bürgler
 * Licensed under the MIT license.
 */

"use strict";

var rest = require("restler"),
	read = require("read"),
	fs = require("fs"),
	path = require("path"),
	mime = require("mime"),
	Q = require("q");

module.exports = function (grunt) {

	grunt.registerTask("upload", function () {
		var done = this.async();

		var options = this.options({
			usernamePrompt: "Username: ",
			passwordPrompt: "Password: ",
			passwordReplaceChar: "*",
			host: "http://ecms.swarovski.com",
			nodeId: null,
			imagesFolderId: null,
			scriptsFolderId: null,
			fontsFolderId: null,
			stylesFolderId: null,
			images: null,
			scripts: null,
			fonts: null,
			styles: null
		});

		var requestConfig = {
			nodeId: options.nodeId,
			query: {
				sid: null
			},
			headers: {
				Cookie: null
			}
		};

		var files = [];

		var log = function (msg) {
			if (msg) {
				grunt.file.write("./log.json", msg);
			}
		};

		var login = function (user, pw) {
			var deferred = Q.defer();

			makeRequest("postJson", "/CNPortletapp/rest/auth/login", {
				login: user,
				password: pw
			}).then(function (data) {
				deferred.resolve(data);
			}).fail(function () {
				deferred.reject();
				done(false);
			});

			return deferred.promise;
		};

		var logout = function () {
			return makeRequest("post", "/CNPortletapp/rest/auth/logout/" + requestConfig.query.sid, requestConfig);
		};

		var getFiles = function (uri) {
			var deferred = Q.defer();
			makeRequest("get", uri, requestConfig).then(function (data) {
				if (data && (data.files || data.pages || data.images)) {
					var _files = data.files || data.pages || data.images;

					if (_files) {
						files = files.concat(_files);
						console.log(files.length);
					} else {
						grunt.warn("Response type not recognized!");
						deferred.reject();
						done(false);
					}
				}
				deferred.resolve(data.files);
			});

			return deferred.promise;
		};

		var isExisting = function (name) {
			for (var i = 0; i < files.length; i++) {
				if (files[i].fileName && files[i].fileName === name) {
					return files[i];
				}

				if (files[i].name && files[i].name === name) {
					return files[i];
				}
			};

			return false;
		}

		var pushFile = function (filePath, folderId) {
			var deferred = Q.defer(),
				URI = "/CNPortletapp/rest/file/create",
				existingFile = isExisting(path.basename(filePath));

			if (existingFile) {
				URI = "/CNPortletapp/rest/file/save/" + existingFile.id;
			}

			fs.stat(filePath, function (error, stat) {
				var _options = {
					multipart: true,
					headers: {
						Cookie: requestConfig.headers.Cookie
					},
					data: {
						sid: requestConfig.query.sid,
						name: path.basename(filePath),
						folderId: folderId,
						nodeId: options.nodeId,
						fileName: path.basename(filePath),
						fileBinaryData: rest.file(filePath, null, stat["size"], null, mime.lookup(filePath))
					}
				};

				makeRequest("post", URI, _options).then(function (data) {
					deferred.resolve(data);
				});
			});

			return deferred.promise;
		};

		var handleFolder = function (folder) {
			var deferred = Q.defer();

			if (!options[folder + "FolderId"]) {
				grunt.warn(folder + "FolderId not provided!");
				done(false);
				deferred.reject();
			}

			fs.exists(options[folder], function (exists) {
				if (exists) {

					if (!options[folder].match(/.*\/$/)) {
						options[folder] = options[folder] + "/";
					}
					fs.readdir(options[folder], function (error, list) {
						var promises = [];
						list.forEach(function (file) {
							if (file.substring(0, 1) !== ".") {
								if (folder === "styles") {
									promises.push(pushPage(file));
								} else {
									promises.push(pushFile(options[folder] + file, options[folder + "FolderId"]));
								}
							}
						});

						Q.all(promises).then(function (d) {
							grunt.log.writeln("\r\nAll " + folder + " uploaded!");
							deferred.resolve(d);
						}).fail(function (e) {
							deferred.reject(e);
						});
					});
				} else {
					grunt.warn("Folder '" + options[folder] + "' does not exist!");
					deferred.reject();
					done(false);
				}

			});
			return deferred.promise;
		};

		var pushPage = function (fileName) {
			var deferred = Q.defer(),
				URI = "/CNPortletapp/rest/page/create",
				existingFile = isExisting(path.basename(fileName)),
				data = {
					folderId: options.stylesFolderId,
					templateId: options.templateId,
					nodeId: options.nodeId,
					language: "en"
				},
				resp;

			if (existingFile) {
				getPageTags(existingFile).then(function (data) {
					var tags = {},
						cssTag;

					if (data.tags.length) {
						data.tags.forEach(function (el) {
							if (el.name.match(/_css/)) {
								cssTag = el;
							}
						});
					}

					fs.readFile(options.styles + "/" + fileName, "utf8", function (error, data) {
						if (cssTag) {
							cssTag.properties.text.stringValue = data;
							cssTag.active = true;
							tags[cssTag.name] = cssTag;
						} else {
							grunt.warn("Could not find CSS Tag in page! Check if tagname includes _css!");
						}

						savePage(existingFile, {
							"page": {
								"id": existingFile.id,
								"name": fileName.substring(0, fileName.indexOf(".")),
								"fileName": fileName,
								"tags": tags
							}
						}).then(function (data) {
							publishPage(existingFile).then(function () {
								deferred.resolve();
							});
						});
					});
				});
			} else {
				rest.postJson(options.host + "/CNPortletapp/rest/page/create", data, requestConfig).on("success", function (data, response) {
					var page = data.page;

					getPageTags(data.page).then(function (data) {
						var tags = {},
							cssTag;

						if (data.tags.length) {
							data.tags.forEach(function (el) {
								if (el.name.match(/_css/)) {
									cssTag = el;
								}
							});
						}

						fs.readFile(options.styles + "/" + fileName, "utf8", function (error, data) {
							if (cssTag) {
								cssTag.properties.text.stringValue = data;
								cssTag.active = true;
								tags[cssTag.name] = cssTag;
							} else {
								grunt.warn("Could not find CSS Tag in page! Check if tagname includes _css!");
							}

							savePage(page, {
								"page": {
									"id": page.id,
									"name": fileName.substring(0, fileName.indexOf(".")),
									"fileName": fileName,
									"tags": tags
								}
							}).then(function () {
								publishPage(page).then(function () {
									deferred.resolve();
								});
							});
						});
					});
				});
			}

			return deferred.promise;
		};

		var getPageTags = function (page) {
			return makeRequest("get", "/CNPortletapp/rest/page/getTags/" + page.id, requestConfig);
		}

		var savePage = function (page, data) {
			return makeRequest("postJson", "/CNPortletapp/rest/page/save/" + page.id, data);
		};

		var publishPage = function (page) {
			return makeRequest("postJson", "/CNPortletapp/rest/page/publish/" + page.id, {});
		};

		var makeRequest = function (type, uri, data) {
			var deferred = Q.defer();

			rest[type](options.host + uri, data, requestConfig).on("success", function (data, response) {
				log(response.raw);

				if (!requestConfig.query.sid && data.sid) {
					requestConfig.query.sid = data.sid;
				}
				if (!requestConfig.headers.Cookie && response.headers["set-cookie"]) {
					requestConfig.headers.Cookie = response.headers["set-cookie"];
				}

				deferred.resolve(data);
			}).on("fail", function (data, response) {
				log(response.raw);
				grunt.warn(data);
				deferred.reject(data);
				done(false);
			}).on("error", function (data, response) {
				log(response.raw);
				grunt.warn(data);
				deferred.reject(data);
				done(false);
			});

			return deferred.promise;
		};


		/**
		 * Read credentials and perform tasks.
		 */
		read({
			prompt: options.usernamePrompt
		}, function (error, username) {
			read({
				prompt: options.passwordPrompt,
				silent: true,
				replace: options.passwordReplaceChar
			}, function (error, password) {
				login(username, password).then(function (data) {
					debugger;

					console.log("Successfully logged in!");
					var promises = [];

					if (!data.user) {
						throw new Error("Can't authenticate!");
					}

					if (!options.images && !options.scripts && !options.fonts && !options.styles) {
						grunt.warn("No source folder provided! You have to specify at least one folder!");
						done(false);
					}

					if (options.imagesFolderId && options.images) {
						promises.push(getFiles("/CNPortletapp/rest/folder/getImages/" + options.imagesFolderId).then(function () {
							return handleFolder("images");
						}));
					}
					if (options.scriptsFolderId && options.scripts) {
						promises.push(getFiles("/CNPortletapp/rest/folder/getFiles/" + options.scriptsFolderId).then(function () {
							return handleFolder("scripts");
						}));
					}
					if (options.fontsFolderId && options.fonts) {
						promises.push(getFiles("/CNPortletapp/rest/folder/getFiles/" + options.fontsFolderId).then(function () {
							return handleFolder("fonts");
						}));
					}
					if (options.stylesFolderId && options.styles) {
						// getFiles("/CNPortletapp/rest/folder/getPages/" + options.stylesFolderId).then(function () {
						// 	return handleFolder("styles");
						// });
					}

					Q.all(promises).then(function () {
						console.log(files.length);
						log(JSON.stringify(files))
						done();
					});
				}).fail(function (data) {
					grunt.warn(data);
					done(false);
				});
			})
		});
	});

};